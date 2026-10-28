import { Notice, PluginSettingTab, Setting, setIcon, type SettingDefinitionGroup, type SettingDefinitionItem } from 'obsidian';
import type ParaFlowPlugin from './main.js';
import { DEFAULT_ENHANCEMENTS, OTHER_ENHANCEMENTS, normalizeEnhancements, type EnhancementSettings, type EnhancementToggle } from './enhancement-settings.js';
import { translate as t, type MessageKey } from './settings-ui/i18n.js';
import { en } from './settings-ui/en.js';
import { renderThemePage, renderMarker, type ThemePageHost } from './settings-ui/theme-page.js';

type Choice = Record<string, string>;
type Toggle = { enabled: () => boolean; save: (value: boolean) => Promise<void> };

export class ParaFlowSettingTab extends PluginSettingTab {
	private items: SettingDefinitionItem[] = [];
	private group!: SettingDefinitionGroup;
	private groupDisabled = () => false;
	private helpSequence = 0;
	private renderedRows = new Map<MessageKey, HTMLElement>();
	constructor(private readonly paraFlow: ParaFlowPlugin) { super(paraFlow.app, paraFlow); }

	getSettingDefinitions(): SettingDefinitionItem[] {
		return (['theme', 'editing', 'other'] as const).map(category => {
			this.items = [];
			if (category === 'theme') renderThemePage(this.themeHost());
			else if (category === 'editing') this.defineEditing();
			else this.defineOther();
			return { type: 'page', name: t(category), items: this.items };
		});
	}

	private refreshSettings(): void {
		const active = this.containerEl.ownerDocument.activeElement;
		const key = active?.closest<HTMLElement>('[data-setting]')?.dataset.setting as MessageKey | undefined;
		const control = active?.getAttribute('data-control');
		const restoreFocus = key && active && this.renderedRows.get(key)?.contains(active);
		this.update();
		if (restoreFocus && key && control) this.renderedRows.get(key)?.querySelector<HTMLElement>(`[data-control="${control}"]`)?.focus({ preventScroll: true });
	}

	private accessibleNames(row: HTMLElement): void {
		// Obsidian treats aria-label as hover text; labelledby avoids duplicate tooltips.
		const labels = this.element(row, 'div');
		labels.hidden = true;
		for (const control of row.querySelectorAll<HTMLElement>('[aria-label]')) {
			const label = this.element(labels, 'span');
			label.id = `paraflow-setting-label-${++this.helpSequence}`;
			label.textContent = control.getAttribute('aria-label');
			control.setAttribute('aria-labelledby', label.id);
			control.removeAttribute('aria-label');
		}
	}

	private element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string): HTMLElementTagNameMap[K] {
		return parent.createEl(tag, { cls });
	}

	private help(setting: Setting, key: MessageKey): void {
		const helpKey = `${key}Help`;
		if (!(helpKey in en) || !t(helpKey as MessageKey)) return;
		const host = this.element(setting.nameEl, 'span', 'paraflow-setting-help');
		const button = this.element(host, 'button', 'paraflow-setting-help-button');
		button.type = 'button'; button.setAttribute('aria-label', `${t(key)} — ${t('help')}`);
		setIcon(button, 'circle-help');
		const tooltip = this.element(host, 'span', 'paraflow-setting-help-text');
		tooltip.id = `paraflow-setting-help-${++this.helpSequence}`;
		tooltip.setAttribute('role', 'tooltip');
		tooltip.textContent = t(helpKey as MessageKey);
		button.setAttribute('aria-describedby', tooltip.id);
		button.setAttribute('aria-expanded', 'false');
		button.addEventListener('click', () => {
			host.classList.remove('is-dismissed');
			const open = host.classList.toggle('is-open');
			button.setAttribute('aria-expanded', String(open));
		});
		button.addEventListener('blur', () => { host.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false'); });
		button.addEventListener('keydown', event => {
			if (event.key === 'Escape') {
				event.stopPropagation(); host.classList.remove('is-open'); host.classList.add('is-dismissed');
				button.setAttribute('aria-expanded', 'false');
			}
		});
		for (const event of ['mouseenter', 'focusin']) host.addEventListener(event, () => host.classList.remove('is-dismissed'));
	}

	private async save(action: () => Promise<void>, refresh = false): Promise<void> {
		try { await action(); if (refresh) this.refreshSettings(); }
		catch (error) { new Notice(String(error)); this.refreshSettings(); }
	}

	private section(key: MessageKey, master?: Toggle): void {
		this.group = { type: 'group', heading: t(key), cls: `paraflow-settings paraflow-settings-fields paraflow-settings-${key}`, items: [] };
		this.items.push(this.group);
		this.groupDisabled = () => false;
		if (master) this.row(key, setting => setting.addToggle(toggle => toggle.setValue(master.enabled())
			.onChange(value => this.save(() => master.save(value), true))), undefined, true);
		this.groupDisabled = () => master ? !master.enabled() : false;
	}

	private feature(key: EnhancementToggle & MessageKey): void {
		this.section(key, { enabled: () => this.paraFlow.enhancements[key], save: value => this.paraFlow.setEnhancement(key, value) });
	}

	private row(key: MessageKey, build: (setting: Setting) => unknown, disabled = () => false, description = false): void {
		const groupDisabled = this.groupDisabled;
		const helpKey = `${key}Help` as MessageKey;
		this.group.items!.push({
			name: t(key), desc: helpKey in en ? t(helpKey) : undefined,
			aliases: [en[key]],
			render: setting => {
				const isDisabled = groupDisabled() || disabled();
				setting.settingEl.classList.add('paraflow-settings');
				setting.settingEl.dataset.setting = key;
				if (!description) { setting.setDesc(''); this.help(setting, key); }
				setting.setDisabled(false);
				build(setting);
				if (isDisabled) setting.setDisabled(true);
				setting.settingEl.classList.toggle('is-disabled', isDisabled);
				const controls = setting.controlEl.querySelectorAll<HTMLElement>('input, select, button, [role="switch"], .checkbox-container');
				controls.forEach((control, index) => {
					if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', control.tagName === 'BUTTON' && control.textContent ? control.textContent : t(key));
					control.dataset.control = String(index);
				});
				this.accessibleNames(setting.settingEl);
				this.renderedRows.set(key, setting.settingEl);
				return () => { if (this.renderedRows.get(key) === setting.settingEl) this.renderedRows.delete(key); };
			},
		});
	}

	private toggle(key: EnhancementToggle & MessageKey, disabled = () => false): void {
		this.row(key, setting => setting.addToggle(toggle => toggle.setValue(this.paraFlow.enhancements[key])
			.onChange(value => this.save(() => this.paraFlow.setEnhancement(key, value), true))), disabled);
	}

	private choices(pairs: Array<[string, MessageKey]>): Choice { return Object.fromEntries(pairs.map(([value, key]) => [value, t(key)])); }

	private select<K extends keyof EnhancementSettings & MessageKey>(key: K, choices: Choice, disabled = () => false): void {
		this.row(key, setting => setting.addDropdown(dropdown => dropdown.addOptions(choices)
			.setValue(String(this.paraFlow.enhancements[key])).onChange(value => this.save(() => this.paraFlow.setEnhancement(key, normalizeEnhancements({ [key]: value })[key])))), disabled);
	}

	private number(key: 'bodyTabSize' | 'paragraphSpacingEm', min: number, max: number, nullable = false): void {
		this.row(key, setting => {
			setting.controlEl.classList.add('paraflow-setting-custom');
			let numberInput: HTMLInputElement;
			let rangeInput: HTMLInputElement;
			const defaultValue = nullable ? null : 8;
			const current = this.paraFlow.enhancements[key];
			const step = key === 'paragraphSpacingEm' ? 0.1 : 1;
			const save = (value: number | null) => this.save(() => key === 'bodyTabSize'
				? this.paraFlow.setEnhancement(key, value as number) : this.paraFlow.setEnhancement(key, value));
			setting.addSlider(slider => {
				rangeInput = slider.sliderEl;
				rangeInput.addEventListener('input', () => { numberInput.value = rangeInput.value; });
				slider.setLimits(min, max, step).setValue(current ?? 0).onChange(value => {
					numberInput.value = String(value); void save(value);
				});
			});
			setting.addText(text => {
				numberInput = text.inputEl;
				numberInput.classList.add('paraflow-setting-number');
				numberInput.type = 'number'; numberInput.min = String(min); numberInput.max = String(max);
				numberInput.step = String(step);
				text.setPlaceholder(nullable ? t('preset') : '8').setValue(String(current ?? '')).onChange(input => {
					const parsed = Number(input);
					const valid = input.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max && (nullable || Number.isInteger(parsed));
					const value = valid ? parsed : defaultValue;
					rangeInput.value = String(value ?? 0);
					if (!valid && numberInput.ownerDocument.activeElement !== numberInput) numberInput.value = '';
					void save(value);
				});
				numberInput.addEventListener('blur', () => {
					if (!numberInput.validity.valid || !numberInput.value) numberInput.value = '';
				});
			});
		});
	}

	private defineEditing(): void {
		const plugin = this.paraFlow;
		this.section('paragraphEditingEnabled', { enabled: () => plugin.paragraphEditingEnabled, save: value => plugin.setParagraphEditingEnabled(value) });
		this.row('htmlBreakMarkersEnabled', setting => setting.addToggle(toggle => toggle.setValue(plugin.htmlBreakMarkersEnabled)
			.onChange(value => this.save(() => plugin.setLineBreakMarkersEnabled('html', value)))));
		this.toggle('paragraphIndent');
		this.number('paragraphSpacingEm', 0, 10, true);
		this.select('bodyTabMode', this.choices([['fixed', 'fixed'], ['tab-stops', 'tabStops']]));
		this.number('bodyTabSize', 1, 32);
		this.section('structuredListEditingEnabled', { enabled: () => plugin.structuredListEditingEnabled, save: value => plugin.setStructuredListEditingEnabled(value) });
		renderMarker(this.themeHost());
		this.feature('inline');
		this.row('editLinksOnPlainClick', setting => setting.addDropdown(dropdown => dropdown.addOptions(this.choices([['edit', 'editLink'], ['open', 'openLink']]))
			.setValue(plugin.editLinksOnPlainClick ? 'edit' : 'open').onChange(value => this.save(() => plugin.setEditLinksOnPlainClick(value === 'edit')))));
		this.toggle('subscript'); this.toggle('superscript');
		this.select('commentDisplay', this.choices([['always', 'always'], ['editing', 'whenEditing']]));
		this.feature('table'); this.toggle('tableDisplay'); this.toggle('tableEditing');
		this.toggle('tableAutoWrap', () => !plugin.enhancements.tableDisplay && !plugin.enhancements.tableEditing);
		this.toggle('mergeWarning', () => !plugin.enhancements.tableEditing);
		this.feature('code'); this.toggle('codeWordWrap'); this.toggle('codeLineNumbers');
		this.select('codeLanguagePosition', this.choices([['off', 'off'], ['top-right', 'topRight'], ['bottom-right', 'bottomRight']]));
		this.select('codeSourcePalette', this.choices([['obsidian', 'followObsidian'], ['one-light', 'oneLight'], ['solarized', 'solarized'], ['light-plus', 'lightPlus']]));
		this.feature('math');
		this.select('mathSourcePalette', { ...this.choices([['one-light', 'oneLight'], ['solarized', 'solarized'], ['light-plus', 'lightPlus'], ['obsidian', 'followObsidian']]), typora: 'Typora' });
		this.feature('images'); this.toggle('imageSourceReveal'); this.toggle('imageCenter');
		this.feature('headings');
		this.feature('callout');
		this.select('calloutStyle', { default: 'default', obsidian: 'obsidian' });
		this.feature('footnotes');
		this.feature('mermaid');
		this.feature('htmlBlocks');
		this.toggle('detailsHoverBackground');
		this.feature('clipboard');
		for (const key of ['livePreviewPasteMode', 'sourcePasteMode'] as const) this.select(key, this.choices([['exact', 'exact'], ['smart', 'smart']]));
		this.toggle('pasteCloseCodeFences');
		this.section('interaction');
		this.row('disableSelectedTextDrag', setting => setting.addToggle(toggle => toggle.setValue(plugin.disableSelectedTextDrag).onChange(value => this.save(() => plugin.setDisableSelectedTextDrag(value)))));
		this.row('hideCaretWhileDragSelecting', setting => setting.addToggle(toggle => toggle.setValue(plugin.hideCaretWhileDragSelecting).onChange(value => this.save(() => plugin.setHideCaretWhileDragSelecting(value)))));
		this.feature('sourceView');
		for (const key of ['sourceActiveLine', 'sourceWhitespace', 'sourceNewlineMarkers'] as const) this.toggle(key);
		this.row('sourceIndentGuides', setting => setting.addToggle(toggle => toggle.setValue(!plugin.enhancements.sourceIndentGuides)
			.onChange(value => this.save(() => plugin.setEnhancement('sourceIndentGuides', !value)))));
		this.toggle('sourceLineNumbers');
		this.select('sourceLineNumberStyle', this.choices([['full', 'full'], ['compact', 'compact']]), () => !plugin.enhancements.sourceLineNumbers);
		this.select('sourceLineNumberPosition', this.choices([['editor-left', 'editorLeft'], ['body-left', 'bodyLeft']]), () => !plugin.enhancements.sourceLineNumbers);
		this.row('sourceTabSize', setting => setting.addDropdown(dropdown => {
			for (let size = 1; size <= 8; size++) dropdown.addOption(String(size), String(size));
			dropdown.setValue(String(plugin.enhancements.sourceTabSize)).onChange(value => this.save(() => plugin.setEnhancement('sourceTabSize', Number(value))));
		}));
		this.section('misc');
		this.row('maintenance', setting => setting.addDropdown(dropdown => dropdown.addOptions(this.choices([['never', 'never'], ['save', 'onManualSave'], ['mode-change', 'onModeChange'], ['both', 'onSaveAndModeChange']]))
			.setValue(plugin.enhancements.maintainListIndentOnSave ? plugin.enhancements.maintainListIndentOnModeChange ? 'both' : 'save' : plugin.enhancements.maintainListIndentOnModeChange ? 'mode-change' : 'never')
			.onChange(value => this.save(() => plugin.setSourceMaintenanceMode(value as 'never' | 'save' | 'mode-change' | 'both')))));
		this.row('resetEditing', setting => setting.addButton(button => button.setButtonText(t('resetEditing')).onClick(() => this.save(() => plugin.resetEditingSettings(), true))));
	}

	private defineOther(): void {
		this.section('other');
		for (const key of OTHER_ENHANCEMENTS) this.toggle(key);
		this.row('resetOther', setting => setting.addButton(button => button.setButtonText(t('resetOther')).onClick(() => this.save(async () => {
			for (const key of OTHER_ENHANCEMENTS) await this.paraFlow.setEnhancement(key, DEFAULT_ENHANCEMENTS[key]);
		}, true))));
	}

	private themeHost(): ThemePageHost {
		return {
			plugin: this.paraFlow,
			section: key => this.section(key),
			row: (key, build, disabled) => this.row(key, build, disabled),
			save: (action, refresh) => this.save(action, refresh),
			refresh: () => this.refreshSettings(),
		};
	}
}
