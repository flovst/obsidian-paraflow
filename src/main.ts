import type { EditorState } from '@codemirror/state';
import { editorLivePreviewField, Plugin } from 'obsidian';
import { createBrowserClipboardSink } from './clipboard.js';
import {
	createStructuredListExtension,
	createStructuredListRuntimeServiceFactory,
} from './editor/structured-list/extension.js';
import { ParaFlowSettingTab } from './settings-tab.js';
import { normalizeSettings, type ParaFlowSettings } from './settings.js';
import {
	createStructuredListExtensionLifecycle,
	type StructuredListExtensionLifecycle,
} from './structured-list-lifecycle.js';

export function isParaFlowLivePreview(state: EditorState): boolean {
	return state.field(editorLivePreviewField, false) === true;
}

export default class ParaFlowPlugin extends Plugin {
	private settings: ParaFlowSettings = normalizeSettings(null);
	private structuredListLifecycle: StructuredListExtensionLifecycle | null = null;

	get structuredListEditingEnabled(): boolean {
		return this.settings.structuredListEditingEnabled;
	}

	async onload(): Promise<void> {
		const clipboard = createBrowserClipboardSink();
		const services = createStructuredListRuntimeServiceFactory({ clipboard });
		this.structuredListLifecycle = createStructuredListExtensionLifecycle({
			registerEditorExtension: (extension) => this.registerEditorExtension(extension),
			updateOptions: () => this.app.workspace.updateOptions(),
		}, () => createStructuredListExtension({
			isLivePreview: isParaFlowLivePreview,
			services,
		}));
		this.settings = normalizeSettings(await this.loadData());
		this.structuredListLifecycle.setEnabled(this.settings.structuredListEditingEnabled);
		this.addSettingTab(new ParaFlowSettingTab(this));
	}

	async setStructuredListEditingEnabled(enabled: boolean): Promise<void> {
		if (enabled === this.settings.structuredListEditingEnabled) return;
		const nextSettings: ParaFlowSettings = { structuredListEditingEnabled: enabled };
		await this.saveData(nextSettings);
		this.settings = nextSettings;
		if (!this.structuredListLifecycle) throw new Error('ParaFlow lifecycle is not initialized');
		this.structuredListLifecycle.setEnabled(enabled);
	}
}
