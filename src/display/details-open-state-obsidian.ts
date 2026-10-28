import { MarkdownView, TFile, type Plugin } from 'obsidian';
import type { DetailsOpenState } from './details-open-state.js';

/** Disk updates enter through the vault, never through an asynchronous preview render. */
export function registerDetailsOpenState(plugin: Plugin, cache: DetailsOpenState): void {
	let disposed = false;
	const reads = new Map<string, number>();
	const refresh = async (file: TFile) => {
		const path = file.path, before = cache.source(path);
		if (before === undefined) return;
		const revision = (reads.get(path) ?? 0) + 1; reads.set(path, revision);
		const source = await plugin.app.vault.cachedRead(file);
		if (disposed || file.path !== path || reads.get(path) !== revision) return;
		// A saved snapshot can arrive while the same editor already contains a newer edit.
		const editing = plugin.app.workspace.getLeavesOfType('markdown').some(leaf => leaf.view instanceof MarkdownView
			&& leaf.view.file?.path === path && leaf.view.getMode() === 'source' && leaf.view.editor.getValue() !== source);
		if (!editing) cache.update(path, before, source);
	};
	plugin.registerEvent(plugin.app.vault.on('modify', file => {
		if (file instanceof TFile) void refresh(file).catch(error => console.error('ParaFlow Details cache update failed', error));
	}));
	plugin.registerEvent(plugin.app.vault.on('rename', (file, previous) => { cache.rename(previous, file.path); }));
	plugin.registerEvent(plugin.app.vault.on('delete', file => { cache.remove(file.path); }));
	plugin.register(() => { disposed = true; reads.clear(); cache.clear(); });
}
