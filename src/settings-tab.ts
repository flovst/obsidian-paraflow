import { Notice, PluginSettingTab, Setting, SettingGroup, setIcon } from 'obsidian';
import type ParaFlowPlugin from './main.js';
import { DEFAULT_ENHANCEMENTS, OTHER_ENHANCEMENTS, normalizeEnhancements, type EnhancementSettings, type EnhancementToggle } from './enhancement-settings.js';
import { translate as t, type MessageKey } from './settings-ui/i18n.js';
import { en } from './settings-ui/en.js';
import { renderThemePage, renderMarker, type ThemePageHost } from './settings-ui/theme-page.js';

type Choice = Record<string, string>;
type Toggle = { enabled: boolean; save: (value: boolean) => Promise<void> };

export class ParaFlowSettingTab extends PluginSettingTab {
	private category: 'theme' | 'editing' | 'other' = 'theme';
	private group!: SettingGroup;
	private groupDisabled = false;
	private helpSequence = 0;
	private expanded = new Set<MessageKey>();
	constructor(private readonly paraFlow: ParaFlowPlugin) { super(paraFlow.app, paraFlow); }

	display(): void {
		const scroll = this.containerEl.querySelector<HTMLElement>('.paraflow-settings-panel')?.scrollTop ?? 0;
		const active = this.containerEl.ownerDocument.activeElement;
		const focusKey = active?.closest<HTMLElement>('[data-setting]')?.dataset.setting;
		const focusControl = active?.getAttribute('data-control');
		this.containerEl.replaceChildren();
		this.containerEl.classList.add('paraflow-settings');
		const navigation = this.element(this.containerEl, 'div', 'paraflow-settings-categories');
		navigation.setAttribute('role', 'tablist');
		navigation.setAttribute('aria-label', t('navigation'));
		const categories = ['theme', 'editing', 'other'] as const;
		for (const category of categories) {
			const button = this.element(navigation, 'button');
			button.type = 'button'; button.textContent = t(category);
			button.id = `paraflow-tab-${category}`;
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-selected', String(this.category === category));
			button.setAttribute('aria-controls', 'paraflow-settings-panel');
			button.tabIndex = this.category === category ? 0 : -1;
			button.addEventListener('click', () => {
				this.category = category; this.display();
				this.containerEl.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
			});
			button.addEventListener('keydown', event => {
				if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
				event.preventDefault();
				this.category = event.key === 'Home' ? 'theme' : event.key === 'End' ? 'other' : categories[(categories.indexOf(this.category) + (event.key === 'ArrowRight' ? 1 : categories.length - 1)) % categories.length]!;
				this.display();
				this.containerEl.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
			});
		}
		const panel = this.element(this.containerEl, 'div', 'paraflow-settings-panel');
		panel.id = 'paraflow-settings-panel'; panel.setAttribute('role', 'tabpanel');
		panel.setAttribute('aria-labelledby', `paraflow-tab-${this.category}`);
		if (this.category === 'theme') renderThemePage(panel, this.themeHost());
		else if (this.category === 'editing') this.displayEditing(panel);
		else this.displayOther(panel);
		this.accessibleNames();
		if (focusKey && focusControl) {
			this.containerEl.querySelector<HTMLElement>(`[data-setting="${focusKey}"] [data-control="${focusControl}"]`)?.focus({ preventScroll: true });
		}
		panel.scrollTop = scroll;
	}

	private accessibleNames(): void {
		// Obsidian also treats aria-label as hover text; labelledby keeps names without duplicate tooltips.
		const labels = this.element(this.containerEl, 'div');
		labels.hidden = true;
		for (const control of this.containerEl.querySelectorAll<HTMLElement>('[aria-label]')) {
			const label = this.element(labels, 'span');
			label.id = `paraflow-setting-label-${++this.helpSequence}`;
			label.textContent = control.getAttribute('aria-label');
			control.setAttribute('aria-labelledby', label.id);
			control.removeAttribute('aria-label');
		}
	}

	private element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string): HTMLElementTagNameMap[K] {
		const element = parent.ownerDocument.createElement(tag);
		if (cls) element.className = cls;
		parent.appendChild(element);
		return element;
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
		try { await action(); if (refresh) this.display(); }
		catch (error) { new Notice(String(error)); this.display(); }
	}

	private section(panel: HTMLElement, key: MessageKey, master?: Toggle): void {
		const section = this.element(panel, 'section', 'paraflow-settings-section');
		section.dataset.feature = key;
		const heading = new Setting(section).setName(t(key)).setHeading();
		heading.settingEl.dataset.setting = key;
		const collapsible = this.category === 'editing' && !['headings', 'mermaid', 'footnotes'].includes(key);
		const body = this.element(section, 'div', 'paraflow-settings-section-body');
		body.id = `paraflow-section-${key}`;
		if (this.category === 'editing') {
			const descriptionKey = `${key}Help` as MessageKey;
			if (descriptionKey in en) heading.setDesc(t(descriptionKey));
		} else this.help(heading, key);
		if (collapsible) {
			heading.nameEl.replaceChildren();
			const disclosure = this.element(heading.nameEl, 'button', 'paraflow-section-disclosure');
			disclosure.type = 'button';
			disclosure.dataset.control = 'disclosure';
			disclosure.setAttribute('aria-controls', body.id);
			disclosure.setAttribute('aria-label', t(key));
			const icon = this.element(disclosure, 'span');
			setIcon(icon, 'chevron-down');
			this.element(disclosure, 'span').textContent = t(key);
			const update = () => {
				body.hidden = !this.expanded.has(key);
				disclosure.setAttribute('aria-expanded', String(!body.hidden));
			};
			update();
			disclosure.addEventListener('click', () => {
				if (this.expanded.has(key)) this.expanded.delete(key); else this.expanded.add(key);
				update();
			});
			heading.infoEl.classList.add('paraflow-section-hit-area');
			heading.infoEl.addEventListener('click', event => {
				if (!(event.target as HTMLElement).closest('button')) disclosure.click();
			});
		}
		if (master) heading.addToggle(toggle => {
			toggle.toggleEl.setAttribute('aria-label', t(key));
			toggle.toggleEl.dataset.control = '0';
			toggle.setValue(master.enabled).onChange(value => this.save(() => master.save(value), true));
		});
		this.groupDisabled = master ? !master.enabled : false;
		this.group = new SettingGroup(body).addClass('paraflow-settings-fields');
		section.classList.toggle('is-feature-disabled', this.groupDisabled);
	}

	private feature(panel: HTMLElement, key: EnhancementToggle & MessageKey): void {
		this.section(panel, key, { enabled: this.paraFlow.enhancements[key], save: value => this.paraFlow.setEnhancement(key, value) });
	}

	private row(key: MessageKey, build: (setting: Setting) => unknown, disabled = false): void {
		this.group.addSetting(setting => {
			setting.setName(t(key)); setting.settingEl.dataset.setting = key; this.help(setting, key);
			build(setting);
			if (this.groupDisabled || disabled) setting.setDisabled(true);
			setting.settingEl.classList.toggle('is-disabled', this.groupDisabled || disabled);
			const controls = setting.controlEl.querySelectorAll<HTMLElement>('input, select, button, [role="switch"], .checkbox-container');
			controls.forEach((control, index) => {
				if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', t(key));
				control.dataset.control = String(index);
			});
		});
	}

	private toggle(key: EnhancementToggle & MessageKey, disabled = false): void {
		this.row(key, setting => setting.addToggle(toggle => toggle.setValue(this.paraFlow.enhancements[key])
			.onChange(value => this.save(() => this.paraFlow.setEnhancement(key, value), true))), disabled);
	}

	private choices(pairs: Array<[string, MessageKey]>): Choice { return Object.fromEntries(pairs.map(([value, key]) => [value, t(key)])); }

	private select<K extends keyof EnhancementSettings & MessageKey>(key: K, choices: Choice, disabled = false): void {
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

	private displayEditing(panel: HTMLElement): void {
		const plugin = this.paraFlow;
		this.section(panel, 'paragraphEditingEnabled', { enabled: plugin.paragraphEditingEnabled, save: value => plugin.setParagraphEditingEnabled(value) });
		this.row('htmlBreakMarkersEnabled', setting => setting.addToggle(toggle => toggle.setValue(plugin.htmlBreakMarkersEnabled)
			.onChange(value => this.save(() => plugin.setLineBreakMarkersEnabled('html', value)))));
		this.toggle('paragraphIndent');
		this.number('paragraphSpacingEm', 0, 10, true);
		this.select('bodyTabMode', this.choices([['fixed', 'fixed'], ['tab-stops', 'tabStops']]));
		this.number('bodyTabSize', 1, 32);
		this.section(panel, 'structuredListEditingEnabled', { enabled: plugin.structuredListEditingEnabled, save: value => plugin.setStructuredListEditingEnabled(value) });
		renderMarker(this.themeHost());
		this.feature(panel, 'inline');
		this.row('editLinksOnPlainClick', setting => setting.addDropdown(dropdown => dropdown.addOptions(this.choices([['edit', 'editLink'], ['open', 'openLink']]))
			.setValue(plugin.editLinksOnPlainClick ? 'edit' : 'open').onChange(value => this.save(() => plugin.setEditLinksOnPlainClick(value === 'edit')))));
		this.toggle('subscript'); this.toggle('superscript');
		this.select('commentDisplay', this.choices([['always', 'always'], ['editing', 'whenEditing']]));
		this.feature(panel, 'table'); this.toggle('tableDisplay'); this.toggle('tableEditing');
		this.toggle('tableAutoWrap', !plugin.enhancements.tableDisplay && !plugin.enhancements.tableEditing);
		this.toggle('mergeWarning', !plugin.enhancements.tableEditing);
		this.feature(panel, 'code'); this.toggle('codeWordWrap'); this.toggle('codeLineNumbers');
		this.select('codeLanguagePosition', this.choices([['off', 'off'], ['top-right', 'topRight'], ['bottom-right', 'bottomRight']]));
		this.select('codeSourcePalette', this.choices([['obsidian', 'followObsidian'], ['one-light', 'oneLight'], ['solarized', 'solarized'], ['light-plus', 'lightPlus']]));
		this.feature(panel, 'math');
		this.select('mathSourcePalette', { ...this.choices([['one-light', 'oneLight'], ['solarized', 'solarized'], ['light-plus', 'lightPlus'], ['obsidian', 'followObsidian']]), typora: 'Typora' });
		this.feature(panel, 'images'); this.toggle('imageSourceReveal'); this.toggle('imageCenter');
		this.feature(panel, 'headings');
		this.feature(panel, 'callout');
		this.select('calloutStyle', { default: 'default', obsidian: 'obsidian' });
		this.feature(panel, 'footnotes');
		this.feature(panel, 'mermaid');
		this.feature(panel, 'htmlBlocks');
		this.toggle('detailsHoverBackground');
		this.feature(panel, 'clipboard');
		for (const key of ['livePreviewPasteMode', 'sourcePasteMode'] as const) this.select(key, this.choices([['exact', 'exact'], ['smart', 'smart']]));
		this.toggle('pasteCloseCodeFences');
		this.section(panel, 'interaction');
		this.row('disableSelectedTextDrag', setting => setting.addToggle(toggle => toggle.setValue(plugin.disableSelectedTextDrag).onChange(value => this.save(() => plugin.setDisableSelectedTextDrag(value)))));
		this.row('hideCaretWhileDragSelecting', setting => setting.addToggle(toggle => toggle.setValue(plugin.hideCaretWhileDragSelecting).onChange(value => this.save(() => plugin.setHideCaretWhileDragSelecting(value)))));
		this.feature(panel, 'sourceView');
		for (const key of ['sourceActiveLine', 'sourceWhitespace', 'sourceNewlineMarkers'] as const) this.toggle(key);
		this.row('sourceIndentGuides', setting => setting.addToggle(toggle => toggle.setValue(!plugin.enhancements.sourceIndentGuides)
			.onChange(value => this.save(() => plugin.setEnhancement('sourceIndentGuides', !value)))));
		this.toggle('sourceLineNumbers');
		this.select('sourceLineNumberStyle', this.choices([['full', 'full'], ['compact', 'compact']]), !plugin.enhancements.sourceLineNumbers);
		this.select('sourceLineNumberPosition', this.choices([['editor-left', 'editorLeft'], ['body-left', 'bodyLeft']]), !plugin.enhancements.sourceLineNumbers);
		this.row('sourceTabSize', setting => setting.addDropdown(dropdown => {
			for (let size = 1; size <= 8; size++) dropdown.addOption(String(size), String(size));
			dropdown.setValue(String(plugin.enhancements.sourceTabSize)).onChange(value => this.save(() => plugin.setEnhancement('sourceTabSize', Number(value))));
		}));
		this.section(panel, 'misc');
		this.row('maintenance', setting => setting.addDropdown(dropdown => dropdown.addOptions(this.choices([['never', 'never'], ['save', 'onManualSave'], ['mode-change', 'onModeChange'], ['both', 'onSaveAndModeChange']]))
			.setValue(plugin.enhancements.maintainListIndentOnSave ? plugin.enhancements.maintainListIndentOnModeChange ? 'both' : 'save' : plugin.enhancements.maintainListIndentOnModeChange ? 'mode-change' : 'never')
			.onChange(value => this.save(() => plugin.setSourceMaintenanceMode(value as 'never' | 'save' | 'mode-change' | 'both')))));
		const footer = this.element(panel, 'div', 'paraflow-settings-footer');
		const reset = new Setting(footer).addButton(button => button.setButtonText(t('resetEditing')).onClick(() => this.save(() => plugin.resetEditingSettings(), true)));
		reset.settingEl.dataset.setting = 'resetEditing';
		reset.controlEl.querySelector('button')!.dataset.control = '0';
		reset.controlEl.querySelector('button')!.setAttribute('aria-label', t('resetEditing'));
	}

	private displayOther(panel: HTMLElement): void {
		this.section(panel, 'other');
		for (const key of OTHER_ENHANCEMENTS) this.toggle(key);
		const footer = this.element(panel, 'div', 'paraflow-settings-footer');
		const reset = new Setting(footer).addButton(button => button.setButtonText(t('resetOther')).onClick(() => this.save(async () => {
			for (const key of OTHER_ENHANCEMENTS) await this.paraFlow.setEnhancement(key, DEFAULT_ENHANCEMENTS[key]);
		}, true)));
		reset.settingEl.dataset.setting = 'resetOther';
		reset.controlEl.querySelector('button')!.dataset.control = '0';
		reset.controlEl.querySelector('button')!.setAttribute('aria-label', t('resetOther'));
	}

	private themeHost(): ThemePageHost {
		return {
			plugin: this.paraFlow,
			section: (panel, key) => this.section(panel, key),
			row: (key, build, disabled) => this.row(key, build, disabled),
			save: (action, refresh) => this.save(action, refresh),
			refresh: () => this.display(),
		};
	}
}
