import { Modal, Notice, Setting, type App } from 'obsidian';
import { convertTyporaTheme } from './converter.js';
import { prepareThemeImport, readImportFiles, themeEntries } from './import-files.js';
import type { ConvertedTheme } from './model.js';
import { translate as t } from '../settings-ui/i18n.js';

export function showThemeReport(app: App, report: string): void {
	const modal = new Modal(app);
	modal.contentEl.createEl('h2', { text: t('conversionReport') });
	modal.contentEl.createEl('pre', { text: report }); modal.open();
}

export class ImportTyporaThemeModal extends Modal {
	private files = new Map<string, Uint8Array>();
	private entry = '';
	private themeName = '';
	private converted: ConvertedTheme | null = null;
	private overrides = '';
	private exportedAssets = new Map<string, Uint8Array>();
	constructor(app: App, private readonly save: (theme: ConvertedTheme, overrides?: string) => Promise<void>) { super(app); }

	onOpen(): void { this.render(); }
	onClose(): void { this.contentEl.empty(); }

	private render(): void {
		this.contentEl.empty();
		this.contentEl.createEl('h2', { text: t('importTheme') });
		this.contentEl.createEl('p', { text: t('importDescription') });
		for (const folder of [false, true]) {
			const label = this.contentEl.createEl('label', { text: t(folder ? 'themeFolder' : 'themeArchive') });
			const input = label.createEl('input', { type: 'file' });
			if (folder) { input.setAttribute('webkitdirectory', ''); input.multiple = true; }
			else input.accept = '.css,.zip';
			input.addEventListener('change', () => { void this.load(Array.from(input.files ?? [])); });
		}
		if (!this.files.size) return;
		const entries = themeEntries(this.files);
		if (!entries.length) { this.contentEl.createEl('p', { text: t('noThemeEntry') }); return; }
		new Setting(this.contentEl).setName(t('themeEntry')).addDropdown(dropdown => {
			for (const entry of entries) dropdown.addOption(entry, entry);
			dropdown.setValue(this.entry).onChange(value => { this.entry = value; this.converted = null; this.render(); });
		});
		new Setting(this.contentEl).setName(t('themeName')).addText(text => text.setValue(this.themeName).onChange(value => { this.themeName = value; this.converted = null; }));
		new Setting(this.contentEl).addButton(button => button.setButtonText(t('previewConversion')).onClick(() => {
			try {
				const id = `imported-${crypto.randomUUID()}`;
				const converted = convertTyporaTheme({ entry: this.entry, files: this.files }, { id, name: this.themeName.trim() || t('importedTheme') });
				this.converted = { ...converted, assets: new Map([...this.exportedAssets, ...converted.assets]) };
				this.render();
			} catch (error) { new Notice(String(error)); }
		}));
		if (!this.converted) return;
		const counts = { mapped: 0, approximate: 0, skipped: 0, error: 0 };
		for (const item of this.converted.diagnostics) counts[item.status]++;
		this.contentEl.createEl('p', { text: t('conversionSummary').replace('{mapped}', String(counts.mapped)).replace('{approximate}', String(counts.approximate)).replace('{skipped}', String(counts.skipped)) });
		const details = this.contentEl.createEl('details'); details.createEl('summary', { text: t('conversionDetails') });
		const list = details.createEl('ul');
		for (const item of this.converted.diagnostics.filter(item => item.status !== 'mapped').slice(0, 100)) {
			list.createEl('li', { text: `${item.file}:${item.line} (${item.surface}) ${item.reason}` });
		}
		new Setting(this.contentEl).setDesc(t('saveThemeHelp')).addButton(button => button.setButtonText(t('saveTheme')).setCta().onClick(async () => {
			if (!this.converted) return;
			button.buttonEl.disabled = true;
			try { await this.save(this.converted, this.overrides || undefined); this.close(); new Notice(t('themeImported')); }
			catch (error) { new Notice(String(error)); button.buttonEl.disabled = false; }
		}));
	}

	private async load(files: File[]): Promise<void> {
		try {
			const input = prepareThemeImport(await readImportFiles(files));
			this.files = input.files; this.converted = null; this.overrides = input.overrides;
			this.exportedAssets = input.assets; this.entry = input.entry; this.themeName = input.name;
			this.render();
		} catch (error) { new Notice(String(error)); }
	}
}
