import { FileSystemAdapter, Notice } from 'obsidian';
import type ParaFlowPlugin from '../main.js';
import { createDetachedEl } from '../dom.js';
import { ImportTyporaThemeModal, showThemeReport } from '../themes/import-modal.js';
import { translate as t } from './i18n.js';

declare const require: (id: 'electron') => { shell: { openPath(path: string): Promise<string> } };

export async function openThemeFolder(plugin: ParaFlowPlugin, id?: string): Promise<void> {
	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) throw new Error(t('desktopOnly'));
	const { shell } = require('electron');
	const error = await shell.openPath(adapter.getFullPath(plugin.contentThemeFolder(id)));
	if (error) throw new Error(error);
}

export async function exportTheme(plugin: ParaFlowPlugin, document: Document, id: string): Promise<void> {
	const bytes = await plugin.exportContentTheme(id);
	const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }));
	const link = createDetachedEl(document, 'a');
	link.href = url; link.download = id + '.zip'; link.click();
	document.defaultView?.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importTheme(plugin: ParaFlowPlugin, changed: () => void): void {
	new ImportTyporaThemeModal(plugin.app, async (theme, overrides) => {
		await plugin.importContentTheme(theme, overrides);
		changed();
	}, () => plugin.contentThemes.map(theme => theme.id)).open();
}

export async function reloadThemes(plugin: ParaFlowPlugin): Promise<void> {
	await plugin.refreshContentThemes();
	new Notice(t('reloaded'));
}

export async function showReport(plugin: ParaFlowPlugin, id: string): Promise<void> {
	showThemeReport(plugin.app, await plugin.contentThemeReport(id));
}
