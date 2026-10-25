import { FileSystemAdapter, Notice, Platform, Setting, normalizePath, type SliderComponent, type TextComponent } from 'obsidian';
import type ParaFlowPlugin from '../main.js';
import { supportsThemeColorScheme, type ThemeOverrides } from '../themes/appearance.js';
import { ImportTyporaThemeModal } from '../themes/import-modal.js';
import { translate as t, type MessageKey } from './i18n.js';

export interface ThemePageHost {
	plugin: ParaFlowPlugin;
	section(panel: HTMLElement, key: MessageKey): void;
	row(key: MessageKey, build: (setting: Setting) => unknown, disabled?: boolean): void;
	save(action: () => Promise<void>, refresh?: boolean): Promise<void>;
	refresh(): void;
}

const imports = new WeakMap<ParaFlowPlugin, { mapped: number; approximate: number; skipped: number }>();
const choices = (pairs: Array<[string, MessageKey]>): Record<string, string> => Object.fromEntries(pairs.map(([value, key]) => [value, t(key)]));
const modes = (): Record<string, string> => choices([['', 'preset'], ['host', 'followObsidian'], ['custom', 'custom']]);

function saveOverride(host: ThemePageHost, key: keyof ThemeOverrides, value: string | number | undefined, refresh = false): Promise<void> {
	return host.save(async () => {
		const next = { ...host.plugin.contentThemeOverrides, [key]: value };
		if (value === undefined) delete next[key];
		await host.plugin.setContentThemeOverrides(next);
	}, refresh);
}

function range(host: ThemePageHost, key: 'fontSize' | 'fontWeight' | 'width' | 'lineHeight', min: number, max: number, step: number, fallback: number): void {
	const current = host.plugin.contentThemeOverrides[key];
	const mode = current === undefined ? '' : current === 'host' ? 'host' : 'custom';
	host.row(key, setting => {
		setting.controlEl.classList.add('paraflow-setting-custom');
		let slider: SliderComponent;
		let text: TextComponent;
		const write = (input: string) => {
			const parsed = Number(input);
			const valid = input.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max && (key !== 'fontWeight' || [300, 400, 500].includes(parsed));
			const value = valid ? parsed : fallback;
			slider.setValue(value);
			if (!valid) text.setValue('');
			void saveOverride(host, key, value);
		};
		setting.addSlider(control => {
			slider = control;
			control.sliderEl.addEventListener('input', () => { text.setValue(control.sliderEl.value); });
			control.setLimits(min, max, step).setValue(typeof current === 'number' ? current : fallback).setDisabled(mode !== 'custom');
			control.onChange(value => { text.setValue(String(value)); void saveOverride(host, key, value); });
		});
		setting.addText(control => {
			text = control;
			control.inputEl.classList.add('paraflow-setting-number');
			control.inputEl.type = 'number'; control.inputEl.min = String(min); control.inputEl.max = String(max); control.inputEl.step = String(step);
			control.setPlaceholder(String(fallback)).setValue(typeof current === 'number' ? String(current) : '').setDisabled(mode !== 'custom');
			// Commit complete values, rather than resetting a number halfway through typing it.
			control.inputEl.addEventListener('change', () => write(control.inputEl.value));
		});
		setting.addDropdown(dropdown => {
			dropdown.selectEl.classList.add('paraflow-setting-mode');
			dropdown.addOptions(modes()).setValue(mode)
				.onChange(value => saveOverride(host, key, value === '' ? undefined : value === 'host' ? 'host' : fallback, true));
		});
	});
}

export function renderMarker(host: ThemePageHost): void {
	host.row('marker', setting => setting.addDropdown(dropdown => dropdown.addOptions(choices([['', 'preset'], ['layered', 'layered'], ['disc', 'disc'], ['circle', 'circle'], ['square', 'square']]))
		.setValue(host.plugin.contentThemeOverrides.marker ?? '').onChange(value => saveOverride(host, 'marker', value || undefined))));
}

export function renderThemePage(panel: HTMLElement, host: ThemePageHost): void {
	const plugin = host.plugin;
	const current = plugin.contentThemeOverrides;
	host.section(panel, 'themeManagement');
	host.row('contentTheme', setting => setting.addDropdown(dropdown => {
		dropdown.addOption('', t('followObsidian'));
		for (const theme of plugin.contentThemes) {
			const duplicate = plugin.contentThemes.filter(item => item.name === theme.name).length > 1;
			dropdown.addOption(theme.id, duplicate ? `${theme.name} (${theme.id.slice(-8)})` : theme.name);
		}
		dropdown.setValue(plugin.contentThemeId ?? '').onChange(id => host.save(() => plugin.setContentTheme(id || null), true));
	}));
	host.row('importTheme', setting => {
		const summary = imports.get(plugin);
		if (summary) setting.setDesc(t('conversionSummary').replace('{mapped}', String(summary.mapped)).replace('{approximate}', String(summary.approximate)).replace('{skipped}', String(summary.skipped)));
		setting.addButton(button => button.setButtonText(t('importTheme')).onClick(() => {
			new ImportTyporaThemeModal(plugin.app, async (theme, overrides) => {
				await plugin.importContentTheme(theme, overrides);
				const counts = { mapped: 0, approximate: 0, skipped: 0 };
				for (const item of theme.diagnostics) if (item.status !== 'error') counts[item.status]++;
				imports.set(plugin, counts); host.refresh();
			}, () => plugin.contentThemes.map(theme => theme.id)).open();
		}));
	});
	host.row('themeFiles', setting => setting
		.addButton(button => button.setButtonText(t('openThemeFolder')).setDisabled(!Platform.isDesktop).onClick(() => host.save(async () => {
			const adapter = plugin.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) throw new Error(t('desktopOnly'));
			const root = normalizePath((plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`) + '/themes');
			// Electron is supplied by desktop Obsidian and kept external by the bundle.
			// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- Obsidian supplies Electron only on desktop.
			const { shell } = require('electron') as { shell: { openPath(path: string): Promise<string> } };
			const error = await shell.openPath(adapter.getFullPath(root));
			if (error) throw new Error(error);
		})))
		.addButton(button => button.setButtonText(t('reload')).onClick(() => host.save(async () => { await plugin.setContentTheme(plugin.contentThemeId, true); new Notice(t('reloaded')); })))
		.addButton(button => button.setButtonText(t('export')).setDisabled(!plugin.contentThemeId || plugin.contentThemeId === 'builtin-classic').onClick(() => host.save(async () => {
			const bytes = await plugin.exportContentTheme();
			const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }));
			const link = panel.ownerDocument.createElement('a'); link.href = url; link.download = plugin.contentThemeId + '.zip'; link.click();
			panel.ownerDocument.defaultView?.setTimeout(() => URL.revokeObjectURL(url), 1000);
		}))));
	const canChooseScheme = supportsThemeColorScheme(plugin.contentThemes.find(theme => theme.id === plugin.contentThemeId));
	host.row('colorScheme', setting => setting.addDropdown(dropdown => {
		dropdown.selectEl.classList.add('paraflow-setting-mode');
		dropdown.addOptions(choices([['', 'preset'], ['host', 'followObsidian'], ['light', 'light'], ['dark', 'dark']]))
			.setValue(canChooseScheme ? current.colorScheme ?? '' : '').onChange(value => saveOverride(host, 'colorScheme', value || undefined));
	}), !canChooseScheme);
	host.row('accentColor', setting => {
		const value = current.accentColor; const mode = value === undefined ? '' : value === 'host' ? 'host' : 'custom';
		setting.controlEl.classList.add('paraflow-setting-custom');
		setting.addColorPicker(color => color.setValue(mode === 'custom' ? value! : '#428bca').setDisabled(mode !== 'custom')
			.onChange(input => saveOverride(host, 'accentColor', input)));
		setting.addDropdown(dropdown => {
			dropdown.selectEl.classList.add('paraflow-setting-mode');
			dropdown.addOptions(modes()).setValue(mode)
				.onChange(source => saveOverride(host, 'accentColor', source === '' ? undefined : source === 'host' ? 'host' : '#428bca', true));
		});
	});
	host.section(panel, 'appearance');
	host.row('fontFamily', setting => {
		const value = current.fontFamily; const mode = value === undefined ? '' : value === 'host' ? 'host' : 'custom';
		setting.controlEl.classList.add('paraflow-setting-custom');
		setting.addText(text => {
			text.setPlaceholder('Georgia, serif').setValue(mode === 'custom' ? value! : '').setDisabled(mode !== 'custom');
			text.inputEl.addEventListener('change', () => {
				const input = text.inputEl.value.trim();
				const valid = input !== '' && input.length <= 300 && !/[;{}<>\\\r\n]|\/\*/u.test(input);
				if (!valid) text.setValue('');
				void saveOverride(host, 'fontFamily', valid ? input : 'Georgia, serif');
			});
		});
		setting.addDropdown(dropdown => {
			dropdown.selectEl.classList.add('paraflow-setting-mode');
			dropdown.addOptions(modes()).setValue(mode)
				.onChange(source => saveOverride(host, 'fontFamily', source === '' ? undefined : source === 'host' ? 'host' : 'Georgia, serif', true));
		});
	});
	range(host, 'fontSize', 10, 48, 1, 16);
	range(host, 'fontWeight', 300, 500, 100, 400);
	range(host, 'lineHeight', 1, 2.5, 0.05, 1.6);
	range(host, 'width', 320, 1600, 10, 800);
	host.section(panel, 'properties');
	host.row('metadataLayout', setting => setting.addDropdown(dropdown => dropdown.addOptions(choices([['content', 'content'], ['native', 'native']]))
		.setValue(current.metadataLayout ?? 'content').onChange(value => saveOverride(host, 'metadataLayout', value))));
	for (const [key, max] of [['metadataPadding', 100], ['metadataGap', 300]] as const) {
		host.row(key, setting => {
			setting.controlEl.classList.add('paraflow-setting-custom');
			let slider: SliderComponent;
			let text: TextComponent;
			const setSlider = (value: number | undefined) => {
				slider.setValue(value ?? 0);
				if (value === undefined) slider.sliderEl.setAttribute('aria-valuetext', t('followObsidian'));
				else slider.sliderEl.removeAttribute('aria-valuetext');
			};
			setting.addSlider(control => {
				slider = control; control.setLimits(0, max, 1); setSlider(current[key]);
				control.sliderEl.addEventListener('input', () => {
					text.setValue(control.sliderEl.value);
					control.sliderEl.removeAttribute('aria-valuetext');
				});
				control.onChange(value => { text.setValue(String(value)); setSlider(value); void saveOverride(host, key, value); });
			});
			setting.addText(control => {
				text = control;
				control.inputEl.type = 'number'; control.inputEl.min = '0'; control.inputEl.max = String(max); control.inputEl.step = '1';
				control.inputEl.classList.add('paraflow-setting-number');
				control.setPlaceholder(t('followObsidian')).setValue(current[key]?.toString() ?? '');
				control.inputEl.addEventListener('change', () => {
					const input = control.inputEl.value; const value = Number(input);
					const valid = input.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= max;
					if (!valid) control.setValue('');
					setSlider(valid ? value : undefined);
					void saveOverride(host, key, valid ? value : undefined);
				});
			});
		});
	}
	const footer = panel.ownerDocument.createElement('div'); footer.className = 'paraflow-settings-footer'; panel.appendChild(footer);
	const reset = new Setting(footer)
		.addButton(button => button.setButtonText(t('reset'))
			.onClick(() => host.save(() => plugin.setContentThemeOverrides(resetThemeValues(plugin.contentThemeOverrides)), true)))
		.addButton(button => button.setButtonText(t('followObsidianAll'))
			.onClick(() => host.save(() => plugin.setContentThemeOverrides({
				...(plugin.contentThemeOverrides.marker ? { marker: plugin.contentThemeOverrides.marker } : {}),
				colorScheme: 'host', accentColor: 'host', fontFamily: 'host', fontSize: 'host', fontWeight: 'host',
				width: 'host', lineHeight: 'host', metadataLayout: 'native',
			}), true)))
		.addButton(button => button.setButtonText(t('followThemeAll'))
			.onClick(() => host.save(() => plugin.setContentThemeOverrides(plugin.contentThemeOverrides.marker
				? { marker: plugin.contentThemeOverrides.marker } : {}), true)));
	reset.settingEl.dataset.setting = 'resetAdjustments';
	reset.controlEl.querySelectorAll('button').forEach((button, index) => {
		button.setAttribute('aria-label', t((['reset', 'followObsidianAll', 'followThemeAll'] as const)[index]!));
		button.dataset.control = String(index);
	});
}

function resetThemeValues(current: ThemeOverrides): ThemeOverrides {
	const next = { ...current };
	const defaults = { fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 400, width: 800, lineHeight: 1.6, accentColor: '#428bca' } as const;
	for (const key of Object.keys(defaults) as Array<keyof typeof defaults>) {
		if (current[key] !== undefined && current[key] !== 'host') Object.assign(next, { [key]: defaults[key] });
	}
	if (current.colorScheme !== 'host') delete next.colorScheme;
	delete next.metadataLayout;
	delete next.metadataPadding;
	delete next.metadataGap;
	return next;
}
