import type { EditorState } from '@codemirror/state';
import { editorLivePreviewField, Plugin } from 'obsidian';
import { createBrowserClipboardSink } from './clipboard.js';
import {
	createEditorExtensionLifecycle,
	type EditorExtensionLifecycle,
} from './editor/extension-lifecycle.js';
import { createEditorRuntimeExtension } from './editor/runtime/navigation-core.js';
import { createParagraphExtension } from './editor/paragraph/extension.js';
import {
	createStructuredListExtension,
	createStructuredListRuntimeServiceFactory,
} from './editor/structured-list/extension.js';
import { isPrimaryLivePreviewEditor } from './editor/surface.js';
import { ParaFlowSettingTab } from './settings-tab.js';
import { normalizeSettings, type ParaFlowSettings } from './settings.js';

export function isParaFlowLivePreview(state: EditorState): boolean {
	return state.field(editorLivePreviewField, false) === true;
}

export default class ParaFlowPlugin extends Plugin {
	private settings: ParaFlowSettings = normalizeSettings(null);
	private editorLifecycle: EditorExtensionLifecycle | null = null;
	private settingsUpdate: Promise<void> = Promise.resolve();

	get paragraphEditingEnabled(): boolean {
		return this.settings.paragraphEditingEnabled;
	}

	get lineBreakMarkersEnabled(): boolean {
		return this.settings.lineBreakMarkersEnabled;
	}

	get structuredListEditingEnabled(): boolean {
		return this.settings.structuredListEditingEnabled;
	}

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		const clipboard = createBrowserClipboardSink();
		const services = createStructuredListRuntimeServiceFactory({ clipboard });
		this.editorLifecycle = createEditorExtensionLifecycle({
			registerEditorExtension: (extension) => this.registerEditorExtension(extension),
			updateOptions: () => this.app.workspace.updateOptions(),
		}, {
			navigationCore: () => createEditorRuntimeExtension({
				isSelectionPresentationActive: (view) =>
					isParaFlowLivePreview(view.state) && isPrimaryLivePreviewEditor(view),
			}),
			paragraph: () => createParagraphExtension({
				isLivePreview: isParaFlowLivePreview,
				isSurface: isPrimaryLivePreviewEditor,
				lineBreakMarkersEnabled: () => this.settings.lineBreakMarkersEnabled,
			}),
			structuredList: () => createStructuredListExtension({
				isLivePreview: isParaFlowLivePreview,
				isSurface: isPrimaryLivePreviewEditor,
				services,
			}),
		}, {
			paragraph: this.settings.paragraphEditingEnabled,
			structuredList: this.settings.structuredListEditingEnabled,
		});
		this.addSettingTab(new ParaFlowSettingTab(this));
	}

	async setParagraphEditingEnabled(enabled: boolean): Promise<void> {
		const update = this.settingsUpdate.then(async () => {
			const lifecycle = this.editorLifecycle;
			if (!lifecycle) throw new Error('ParaFlow lifecycle is not initialized');
			if (enabled === this.settings.paragraphEditingEnabled) return;
			const nextSettings: ParaFlowSettings = {
				...this.settings,
				paragraphEditingEnabled: enabled,
			};
			await this.saveData(nextSettings);
			lifecycle.setEnabled('paragraph', enabled);
			this.settings = nextSettings;
		});
		this.settingsUpdate = update.catch(() => undefined);
		await update;
	}

	async setStructuredListEditingEnabled(enabled: boolean): Promise<void> {
		const update = this.settingsUpdate.then(async () => {
			const lifecycle = this.editorLifecycle;
			if (!lifecycle) throw new Error('ParaFlow lifecycle is not initialized');
			if (enabled === this.settings.structuredListEditingEnabled) return;
			const nextSettings: ParaFlowSettings = {
				...this.settings,
				structuredListEditingEnabled: enabled,
			};
			await this.saveData(nextSettings);
			lifecycle.setEnabled('structured-list', enabled);
			this.settings = nextSettings;
		});
		this.settingsUpdate = update.catch(() => undefined);
		await update;
	}

	async setLineBreakMarkersEnabled(enabled: boolean): Promise<void> {
		const update = this.settingsUpdate.then(async () => {
			const lifecycle = this.editorLifecycle;
			if (!lifecycle) throw new Error('ParaFlow lifecycle is not initialized');
			if (enabled === this.settings.lineBreakMarkersEnabled) return;
			const previous = this.settings;
			const nextSettings: ParaFlowSettings = {
				...previous,
				lineBreakMarkersEnabled: enabled,
			};
			await this.saveData(nextSettings);
			this.settings = nextSettings;
			try {
				lifecycle.refresh('paragraph');
			} catch (error) {
				this.settings = previous;
				throw error;
			}
		});
		this.settingsUpdate = update.catch(() => undefined);
		await update;
	}
}
