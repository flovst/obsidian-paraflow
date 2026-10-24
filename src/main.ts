import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Component, editorEditorField, editorInfoField, editorLivePreviewField, finishRenderMath, getIcon, loadMathJax, loadPrism, MarkdownRenderChild, MarkdownRenderer, MarkdownView, Notice, normalizePath, Platform, Plugin, sanitizeHTMLToDom, TFile } from 'obsidian';
import { createReadingMathRanges } from './reading/math-ranges';
import { createSvgMathRenderer, type NativeMathJax } from './display/math.js';
import { installBundledThemes } from './themes/builtin.js';
import { ThemeStore } from './themes/store.js';
import { ThemeManager } from './themes/manager.js';
import { contentTokenBridge, resolveThemeUrls, scopeOverrides } from './themes/runtime-css.js';
import type { ConvertedTheme, ThemeManifest } from './themes/model.js';
import { createThemeArchive } from './themes/import-files.js';
import { normalizeThemeOverrides, supportsThemeColorScheme, themeOverrideCss, themePaletteCss, type ThemeOverrides } from './themes/appearance.js';
import { createBrowserClipboardSink } from './clipboard.js';
import type { EditorExtensionLifecycle } from './editor/extension-lifecycle.js';
import { createEditorComposition, type EditorComposition } from './editor/editor-composition.js';
import type { LineBreakKind } from './editor/paragraph/line-break-projection.js';
import { isPrimaryLivePreviewEditor, isPrimarySourceEditor } from './editor/surface.js';
import { ParaFlowSettingTab } from './settings-tab.js';
import { normalizeSettings, resetEditingSettings, type ParaFlowSettings, type SourceMaintenanceMode } from './settings.js';
import { normalizeEnhancements, type EnhancementSettings } from './enhancement-settings.js';
import { createReadingEnhancements, type ReadingEnhancements } from './reading/enhancements.js';
import { readNativePrintSource } from './reading/source.js';
import { createReadingMath } from './reading/math.js';
import { createModeScrollAlignment, type ModeScrollView } from './reading/mode-scroll.js';
import { EnhancementStyles } from './display/styles.js';
import { refreshCalloutHeaderIcons, renderCalloutHeaderIcon } from './editor/callout/header-icon.js';
import { createTableEditingIntegration } from './editor/table/obsidian-adapter.js';
import { pasteFromClipboard } from './editor/clipboard-paste.js';
import { createIndentModeMaintenance } from './editor/indent-maintenance-mode.js';
import { planListIndentMaintenance } from './editor/list-indent-maintenance.js';
import { createMathMetadataIntegration } from './metadata/obsidian.js';
import { readNativeDecorationBindingStatus, type NativeDecorationBindingStatus } from './editor/runtime/native-decoration-ownership.js';

export function isParaFlowLivePreview(state: EditorState): boolean {
	return state.field(editorLivePreviewField, false) === true;
}

export default class ParaFlowPlugin extends Plugin {
	private settings: ParaFlowSettings = normalizeSettings(null);
	private editorLifecycle: EditorExtensionLifecycle | null = null;
	private settingsUpdate: Promise<void> = Promise.resolve();
	private themeStore!: ThemeStore;
	private readonly themeManager = new ThemeManager();
	private readonly enhancementStyles = new EnhancementStyles();
	private disposed = false;
	private editorComposition!: EditorComposition;
	private readingEnhancements: ReadingEnhancements | null = null;
	private tableEditing: ReturnType<typeof createTableEditingIntegration> | null = null;
	private refreshMathMetadata: (() => Promise<void>) | null = null;
	contentThemes: ThemeManifest[] = [];

	get contentThemeId(): string | null { return this.settings.contentThemeId; }
	get enhancements(): Readonly<EnhancementSettings> { return this.settings.enhancements; }
	readNativeDecorationBindingStatus(view: EditorView): NativeDecorationBindingStatus {
		return readNativeDecorationBindingStatus(view);
	}

	async setSourceMaintenanceMode(mode: SourceMaintenanceMode): Promise<void> {
		const update = this.settingsUpdate.then(async () => {
			if (this.disposed) return;
			const next = { ...this.settings, enhancements: { ...this.settings.enhancements,
				maintainListIndentOnSave: mode === 'save' || mode === 'both',
				maintainListIndentOnModeChange: mode === 'mode-change' || mode === 'both' } };
			await this.saveData(next);
			if (!this.disposed) this.settings = next;
		});
		this.settingsUpdate = update.catch(() => undefined);
		await update;
	}

	async resetEditingSettings(): Promise<void> {
		const update = this.settingsUpdate.then(async () => {
			if (this.disposed) return;
			const lifecycle = this.editorLifecycle;
			if (!lifecycle) throw new Error('ParaFlow lifecycle is not initialized');
			const previous = this.settings;
			const next = resetEditingSettings(previous);
			const previousTheme = await this.prepareTheme(previous.contentThemeId);
			const theme = await this.prepareTheme(next.contentThemeId, next.themeOverrides[next.contentThemeId ?? 'paraflow-follow'] ?? {});
			const previousExtensions = [...this.editorComposition.supplementalExtensions];
			await this.saveData(next);
			if (this.disposed) return;
			this.settings = next;
			try {
				this.editorComposition.rebuildSupplementalExtensions();
				lifecycle.setEnabled('paragraph', next.paragraphEditingEnabled);
				lifecycle.setEnabled('break-markers', next.breakMarkersEnabled);
				lifecycle.setEnabled('structured-list', next.structuredListEditingEnabled);
				this.app.workspace.updateOptions();
				this.readingEnhancements?.refresh();
				this.themeManager.setTheme(theme);
				this.refreshCalloutIcons();
				await this.refreshMathMetadata?.();
				for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
					if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') leaf.view.previewMode.rerender(true);
				}
			} catch (error) {
				this.settings = previous;
				this.editorComposition.supplementalExtensions.splice(0, this.editorComposition.supplementalExtensions.length, ...previousExtensions);
				const errors: unknown[] = [error];
				for (const [feature, enabled] of [['paragraph', previous.paragraphEditingEnabled], ['break-markers', previous.breakMarkersEnabled], ['structured-list', previous.structuredListEditingEnabled]] as const) {
					try { lifecycle.setEnabled(feature, enabled); } catch (rollbackError) { errors.push(rollbackError); }
				}
				try { this.app.workspace.updateOptions(); } catch (rollbackError) { errors.push(rollbackError); }
				try { this.readingEnhancements?.refresh(); } catch (rollbackError) { errors.push(rollbackError); }
				try { this.themeManager.setTheme(previousTheme); this.refreshCalloutIcons(); } catch (rollbackError) { errors.push(rollbackError); }
				try { await this.saveData(previous); } catch (rollbackError) { errors.push(rollbackError); }
				if (errors.length > 1) throw new AggregateError(errors, 'Editing reset rollback was incomplete');
				throw error;
			}
		});
		this.settingsUpdate = update.catch(() => undefined);
		await update;
	}

	async setEnhancement<K extends keyof EnhancementSettings>(key: K, value: EnhancementSettings[K]): Promise<void> {
		const update = this.settingsUpdate.then(async () => {
			if (this.disposed || this.settings.enhancements[key] === value) return;
			const enhancements = normalizeEnhancements({ ...this.settings.enhancements, [key]: value });
			const next = { ...this.settings, enhancements };
			await this.saveData(next);
			if (this.disposed) return;
			const previous=this.settings;
			const previousExtensions=[...this.editorComposition.supplementalExtensions];
			this.settings = next;
			try {
				this.editorComposition.rebuildSupplementalExtensions();
				this.app.workspace.updateOptions();
				this.readingEnhancements?.refresh();
				if (key === 'math') {
					await this.refreshMathMetadata?.();
					for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
						if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') leaf.view.previewMode.rerender(true);
					}
				}
			} catch(error) {
				this.settings=previous;
				this.editorComposition.supplementalExtensions.splice(0,this.editorComposition.supplementalExtensions.length,...previousExtensions);
				const errors: unknown[] = [error];
				// A host refresh may have updated some views before failing.
				try { this.app.workspace.updateOptions(); } catch (rollbackError) { errors.push(rollbackError); }
				try { this.readingEnhancements?.refresh(); } catch (rollbackError) { errors.push(rollbackError); }
				try { await this.saveData(previous); } catch (rollbackError) { errors.push(rollbackError); }
				if (errors.length > 1) throw new AggregateError(errors,
					`Enhancement update failed and rollback was incomplete: ${errors.map(String).join('; ')}`);
				throw error;
			}
		});
		this.settingsUpdate = update.catch(() => undefined);
		await update;
	}

	get contentThemeOverrides(): ThemeOverrides { return this.settings.themeOverrides[this.contentThemeId ?? 'paraflow-follow'] ?? {}; }

	private syncThemeDocuments(): void {
		const documents = new Set([this.app.workspace.containerEl.ownerDocument]);
		this.app.workspace.iterateAllLeaves(leaf => documents.add(leaf.view.containerEl.ownerDocument));
		this.themeManager.syncDocuments(documents);
		this.enhancementStyles.syncDocuments(documents);
	}

	private refreshCalloutIcons(): void {
		const documents = new Set([this.app.workspace.containerEl.ownerDocument]);
		this.app.workspace.iterateAllLeaves(leaf => documents.add(leaf.view.containerEl.ownerDocument));
		for (const owner of documents) refreshCalloutHeaderIcons(owner);
	}

	private async prepareTheme(id: string | null, overrides = this.settings.themeOverrides[id ?? 'paraflow-follow'] ?? {}): Promise<{ id: string; css: string } | null> {
		const themeId = id ?? 'paraflow-follow';
		const theme = id === null ? null : await this.themeStore.read(id);
		const overrideScheme = supportsThemeColorScheme(theme?.manifest) ? overrides.colorScheme : undefined;
		const scheme = overrideScheme === 'host' ? 'adaptive' : overrideScheme ?? theme?.manifest.colorScheme ?? 'adaptive';
		const css = themePaletteCss(themeId, scheme) + (theme?.css ?? '') + contentTokenBridge(themeId, overrides, theme?.manifest.origin)
			+ themeOverrideCss(themeId, overrides) + scopeOverrides(theme?.overrides ?? '', themeId);
		return { id: themeId, css: resolveThemeUrls(css, path => this.app.vault.adapter.getResourcePath(this.themeStore.path(themeId) + '/' + path)) };
	}

	async setContentThemeOverrides(value: ThemeOverrides): Promise<void> {
		const update = this.settingsUpdate.then(async () => {
			if (this.disposed) return;
			const overrides = normalizeThemeOverrides(value);
			const theme = await this.prepareTheme(this.contentThemeId, overrides);
			if (this.disposed) return;
			const nextSettings = { ...this.settings, themeOverrides: { ...this.settings.themeOverrides, [this.contentThemeId ?? 'paraflow-follow']: overrides } };
			await this.saveData(nextSettings);
			if (this.disposed) return;
			this.settings = nextSettings; this.themeManager.setTheme(theme);
			this.refreshCalloutIcons();
		});
		this.settingsUpdate = update.catch(() => undefined); await update;
	}

	private async initializeThemes(): Promise<void> {
		this.themeStore = new ThemeStore(this.app.vault.adapter, normalizePath((this.manifest.dir ?? this.app.vault.configDir + '/plugins/' + this.manifest.id) + '/themes'));
		await installBundledThemes(this.themeStore);
		const listing = await this.themeStore.list(); this.contentThemes = listing.themes;
		if (listing.warnings.length) new Notice('Some ParaFlow themes could not be loaded: ' + listing.warnings.join('; '));
		try {
			const theme = await this.prepareTheme(this.contentThemeId);
			if (this.disposed) return;
			this.themeManager.setTheme(theme);
			this.refreshCalloutIcons();
		} catch (error) {
			new Notice('Content theme unavailable. Following Obsidian. ' + String(error));
			this.settings = { ...this.settings, contentThemeId: null };
			await this.saveData(this.settings);
		}
	}

	async setContentTheme(id: string | null, reload = false): Promise<void> {
		const update = this.settingsUpdate.then(async () => {
			if (this.disposed) return;
			if (id === this.contentThemeId && !reload) return;
			const theme = await this.prepareTheme(id);
			if (this.disposed) return;
			const nextSettings = { ...this.settings, contentThemeId: id };
			await this.saveData(nextSettings);
			if (this.disposed) return;
			this.themeManager.setTheme(theme); this.settings = nextSettings;
			this.refreshCalloutIcons();
		});
		this.settingsUpdate = update.catch(() => undefined); await update;
	}

	async importContentTheme(theme: ConvertedTheme, overrides?: string): Promise<void> {
		resolveThemeUrls(theme.css + scopeOverrides(overrides ?? '', theme.manifest.id), path => {
			if (!theme.assets.has(path.slice('assets/'.length))) throw new Error(`Missing theme asset: ${path}`);
			return path;
		});
		await this.themeStore.install(theme, overrides);
		this.contentThemes = (await this.themeStore.list()).themes;
	}

	async exportContentTheme(): Promise<Uint8Array> {
		if (this.contentThemeId === null || this.contentThemeId === 'builtin-classic') throw new Error('Select an imported theme to export');
		return createThemeArchive(await this.themeStore.exportFiles(this.contentThemeId));
	}

	async contentThemeReport(): Promise<string> {
		if (this.contentThemeId === null) throw new Error('Select a content theme first');
		const path = this.themeStore.path(this.contentThemeId) + '/conversion-report.json';
		return await this.themeStore.storage.exists(path) ? this.themeStore.storage.read(path) : 'This built-in theme has no conversion report.';
	}

	get hideCaretWhileDragSelecting(): boolean {
		return this.settings.hideCaretWhileDragSelecting;
	}

	get disableSelectedTextDrag(): boolean {
		return this.settings.disableSelectedTextDrag;
	}

	get editLinksOnPlainClick(): boolean {
		return this.settings.editLinksOnPlainClick;
	}

	get paragraphEditingEnabled(): boolean {
		return this.settings.paragraphEditingEnabled;
	}

	get breakMarkersEnabled(): boolean { return this.settings.breakMarkersEnabled; }
	get htmlBreakMarkersEnabled(): boolean { return this.settings.htmlBreakMarkersEnabled; }
	get hardBreakMarkersEnabled(): boolean { return this.settings.hardBreakMarkersEnabled; }

	get structuredListEditingEnabled(): boolean {
		return this.settings.structuredListEditingEnabled;
	}

	private currentEditor(): EditorView | null {
		const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		return (editor as typeof editor & { cm?: EditorView })?.cm ?? null;
	}

	private saveEditor(view: EditorView): Promise<void> {
		const markdown = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdown || this.currentEditor() !== view) throw new Error('Save target is no longer the active editor');
		return markdown.save();
	}

	async onload(): Promise<void> {
		this.register(() => { this.disposed = true; this.themeManager.destroy(); this.enhancementStyles.destroy(); });
		this.settings = normalizeSettings(await this.loadData());
		if (this.disposed) return;
		const modeMaintenance = createIndentModeMaintenance({
			getEnabled: () => this.settings.enhancements.maintainListIndentOnModeChange,
			plan: planListIndentMaintenance,
			getTarget: () => {
				const markdown = this.app.workspace.getActiveViewOfType(MarkdownView);
				const editor = this.currentEditor();
				if (!markdown?.file || !editor) return null;
				return { owner: markdown, file: markdown.file, editor,
					mode: markdown.getMode() === 'preview' ? 'reading' : markdown.getState().source === true ? 'source' : 'live-preview' };
			},
		});
		this.registerEvent(this.app.workspace.on('layout-change', () => modeMaintenance.layoutChanged()));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => modeMaintenance.reset()));
		this.registerEvent(this.app.workspace.on('file-open', () => modeMaintenance.reset()));
		this.syncThemeDocuments();
		this.registerEvent(this.app.workspace.on('layout-change', () => this.syncThemeDocuments()));
		this.registerEvent(this.app.workspace.on('window-open', () => this.syncThemeDocuments()));
		this.registerEvent(this.app.workspace.on('window-close', () => this.syncThemeDocuments()));
		this.registerEvent(this.app.workspace.on('css-change', () => this.refreshCalloutIcons()));
		try { await this.initializeThemes(); }
		catch (error) {
			new Notice('Content theme setup failed. Editor features remain available. ' + String(error));
			this.settings = { ...this.settings, contentThemeId: null };
			this.themeManager.setTheme(null);
			this.refreshCalloutIcons();
		}
		if (this.disposed) return;
		const clipboard = createBrowserClipboardSink();
		const metadataError = (error: unknown): void => { console.error('ParaFlow math metadata adaptation failed', error); new Notice('公式索引适配失败，请查看开发者控制台。'); };
		let metadata: Awaited<ReturnType<typeof createMathMetadataIntegration>> | null = null;
		this.refreshMathMetadata = async () => {
			if (!this.settings.enhancements.math) { metadata?.destroy(); metadata = null; return; }
			if (metadata) return;
			try {
				const current = await createMathMetadataIntegration(this.app, metadataError);
				if (this.disposed) { current.destroy(); return; }
				metadata = current;
				this.app.workspace.onLayoutReady(() => {
					if (!this.disposed && metadata === current) void current.refreshExisting().catch(metadataError);
				});
			} catch (error) { metadataError(error); }
		};
		this.register(() => { metadata?.destroy(); metadata = null; });
		await this.refreshMathMetadata();
		if (this.disposed) return;
		const mathRenderer = createSvgMathRenderer({ document, loadMathJax,
			getMathJax: () => (window as unknown as { MathJax: NativeMathJax }).MathJax });
		const readingMath = createReadingMath({ loadMathJax, finishRenderMath, renderMath: mathRenderer.renderMath, getCachedMath: mathRenderer.getCachedMath,
			onError: error => { console.error('ParaFlow reading math rendering failed', error); } });
		this.register(() => { readingMath.destroy(); mathRenderer.destroy(); });
		const readingRanges = createReadingMathRanges(async (source, target, path, own) => {
			const component = new Component(); component.load(); own(() => component.unload());
			await MarkdownRenderer.render(this.app, source, target, path, component);
		}, mathRenderer.renderMath);
		this.register(() => readingRanges.destroy());
		this.registerMarkdownPostProcessor(async (element, context) => {
			const {math,bodyLayout}=this.settings.enhancements;
			if (!math && !bodyLayout) return;
			await readingRanges.render(element, context.getSectionInfo(element), context.sourcePath, (cleanup, onload) => {
				const child = new MarkdownRenderChild(element); child.onunload = cleanup;
				if (onload) child.onload = onload;
				context.addChild(child);
			}, context.docId,{math,bodyTabs:bodyLayout});
		}, -1100);
		this.registerMarkdownPostProcessor(element => { if (this.settings.enhancements.math || this.settings.enhancements.bodyLayout) readingRanges.finish(element); }, 2100);
		this.registerMarkdownPostProcessor(element => { if (this.settings.enhancements.math) readingMath.capture(element); }, -1000);
		this.registerMarkdownPostProcessor((element, context) => {
			if (!this.settings.enhancements.math) return;
			return readingMath.render(element, (math, cleanup) => {
			const child = new MarkdownRenderChild(math);
			child.onunload = cleanup;
			context.addChild(child);
			});
		}, 1000);
		this.editorComposition = createEditorComposition({
			registerEditorExtension: extension => this.registerEditorExtension(extension),
			updateOptions: () => this.app.workspace.updateOptions(),
		}, {
			getSettings: () => this.settings,
			isLivePreview: isParaFlowLivePreview,
			isPrimaryLivePreviewEditor,
			isPrimarySourceEditor,
			isPrimarySourceState: state => {
				const view = state.field(editorEditorField, false);
				const owner = state.field(editorInfoField, false)?.editor;
				return !!view && (owner as typeof owner & { cm?: EditorView })?.cm === view;
			},
			currentEditor: () => this.currentEditor(),
			saveEditor: view => this.saveEditor(view),
			notify: message => { new Notice(message); },
			clipboard,
			loadPrism,
			mathRendering: { renderMath: mathRenderer.renderMath, getCachedMath: mathRenderer.getCachedMath, isFocused: state => state.field(editorEditorField, false)?.hasFocus === true },
			openReferenceLink: (destination, view) => {
				if (/^(?:javascript|data|vbscript):/iu.test(destination.trim())) return;
				if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(destination)) view.dom.ownerDocument.defaultView!.open(destination, '_external');
				else void this.app.workspace.openLinkText(destination, view.state.field(editorInfoField).file?.path ?? '');
			},
			renderInlineHtml: (source, element, view) => {
				const component = new Component(); component.load();
				let disposed = false;
				void MarkdownRenderer.render(this.app, source, element, view.state.field(editorInfoField).file?.path ?? '', component)
					.then(() => { if (!disposed) view.requestMeasure(); });
				return () => { disposed = true; component.unload(); };
			},
			sourcePath: view => view.state.field(editorInfoField).file?.path ?? '',
			renderMarkdown: (source, target, view) => {
				const component = new Component(); component.load();
				return {
					ready: MarkdownRenderer.render(this.app, source, target, view.state.field(editorInfoField).file?.path ?? '', component),
					destroy: () => component.unload(),
				};
			},
			renderCalloutHeader: (source, element, view) => renderCalloutHeaderIcon(source, element, view, { getIcon, sanitizeHTMLToDom }),
			tableEditingExtension: () => this.tableEditing?.extension ?? null,
		});
		this.editorLifecycle = this.editorComposition.lifecycle;
		this.addSettingTab(new ParaFlowSettingTab(this));
		const currentEditor = () => this.currentEditor();
		for (const mode of ['exact', 'smart'] as const) this.addCommand({
			id: `paste-${mode}`, name: mode === 'exact' ? '本次精确粘贴 / Paste exact text' : '本次智能粘贴 / Smart paste',
			checkCallback: checking => {
				const view = currentEditor();
				if (!this.settings.enhancements.clipboard || !view || !isPrimarySourceEditor(view) || view.state.readOnly) return false;
				if (!checking) void pasteFromClipboard(view, mode, { getView: currentEditor, notify: message => { new Notice(message); } });
				return true;
			},
		});
		this.tableEditing=createTableEditingIntegration(this.app,{
			getBreakEditingEnabled:()=>this.settings.paragraphEditingEnabled,
			isActive:view=>!Platform.isMobile&&this.settings.enhancements.table&&this.settings.enhancements.tableEditing&&isParaFlowLivePreview(view.state)&&isPrimaryLivePreviewEditor(view),
			getView:currentEditor,
			getMergeWarning:()=>this.settings.enhancements.mergeWarning,
			getAutoWrap:()=>this.settings.enhancements.tableAutoWrap,
			setAutoWrap:enabled=>this.setEnhancement('tableAutoWrap',enabled),
			getHideAddControls:()=>this.settings.enhancements.tableHideAddControls,
			setMergeWarning:enabled=>this.setEnhancement('mergeWarning',enabled),
		});
		for(const command of this.tableEditing.commands)this.addCommand(command);
		this.register(() => this.tableEditing?.destroy());
		this.editorComposition.registerSupplementalExtensions();
		const reading = this.readingEnhancements = createReadingEnhancements(() => this.settings.enhancements);
		const modeScroll = createModeScrollAlignment();
		const syncModeScroll = () => modeScroll.syncViews(this.app.workspace.getLeavesOfType('markdown')
			.map(leaf => leaf.view).filter(view => view instanceof MarkdownView) as unknown as ModeScrollView[]);
		this.register(() => modeScroll.destroy());
		this.registerEvent(this.app.workspace.on('layout-change', syncModeScroll));
		syncModeScroll();
		this.register(() => { this.disposed = true; reading.destroy(); });
		this.registerMarkdownPostProcessor(async (element, context) => {
			const printSource = await readNativePrintSource(element, context.getSectionInfo(element) !== null, async () => {
				const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
				return file instanceof TFile ? this.app.vault.cachedRead(file) : null;
			});
			if (this.disposed) return;
			const child = new MarkdownRenderChild(element);
			let cleanup: (() => void) | undefined;
			child.onload = () => {
				const sectionInfo = context.getSectionInfo(element);
				const releaseScroll = sectionInfo ? modeScroll.register(element, context.sourcePath, sectionInfo.lineStart, sectionInfo.lineEnd, sectionInfo.text) : () => {};
				const releaseReading = reading.register(element,
				() => context.getSectionInfo(element)?.text ?? printSource,
				() => {
					const section = context.getSectionInfo(element);
					return section ? section.text.split('\n').slice(section.lineStart, section.lineEnd + 1).join('\n') : printSource;
				}, () => context.getSectionInfo(element));
				cleanup = () => { releaseScroll(); releaseReading(); };
			};
			child.onunload = () => cleanup?.();
			context.addChild(child);
		});
		this.app.workspace.onLayoutReady(() => {
			if (this.disposed) return;
			for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
				if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') leaf.view.previewMode.rerender(true);
			}
		});
	}

	async setParagraphEditingEnabled(enabled: boolean): Promise<void> {
		const update = this.settingsUpdate.then(async () => {
			const lifecycle = this.editorLifecycle;
			if (!lifecycle) throw new Error('ParaFlow lifecycle is not initialized');
			if (enabled === this.settings.paragraphEditingEnabled) return;
			const nextSettings: ParaFlowSettings = {
				...this.settings,
				paragraphEditingEnabled: enabled,
				breakMarkersEnabled: enabled,
				enhancements: { ...this.settings.enhancements, bodyLayout: enabled },
			};
			await this.saveData(nextSettings);
			const previous = this.settings;
			this.settings = nextSettings;
			try {
				lifecycle.setEnabled('paragraph', enabled);
				lifecycle.setEnabled('break-markers', enabled);
				this.readingEnhancements?.refresh();
			} catch (error) {
				this.settings = previous;
				const errors: unknown[] = [error];
				try { lifecycle.setEnabled('paragraph', previous.paragraphEditingEnabled); } catch (rollbackError) { errors.push(rollbackError); }
				try { lifecycle.setEnabled('break-markers', previous.paragraphEditingEnabled); } catch (rollbackError) { errors.push(rollbackError); }
				try { this.app.workspace.updateOptions(); } catch (rollbackError) { errors.push(rollbackError); }
				try { this.readingEnhancements?.refresh(); } catch (rollbackError) { errors.push(rollbackError); }
				try { await this.saveData(previous); } catch (rollbackError) { errors.push(rollbackError); }
				if (errors.length > 1) throw new AggregateError(errors, 'Paragraph update rollback was incomplete');
				throw error;
			}
		});
		this.settingsUpdate = update.catch(() => undefined);
		await update;
	}

	async setEditLinksOnPlainClick(enabled: boolean): Promise<void> {
		const update = this.settingsUpdate.then(async () => {
			if (!this.editorLifecycle) throw new Error('ParaFlow lifecycle is not initialized');
			if (enabled === this.settings.editLinksOnPlainClick) return;
			const nextSettings: ParaFlowSettings = {
				...this.settings,
				editLinksOnPlainClick: enabled,
			};
			await this.saveData(nextSettings);
			this.settings = nextSettings;
		});
		this.settingsUpdate = update.catch(() => undefined);
		await update;
	}

	async setDisableSelectedTextDrag(enabled: boolean): Promise<void> {
		await this.setPointerPreference('disableSelectedTextDrag', enabled);
	}

	async setHideCaretWhileDragSelecting(enabled: boolean): Promise<void> {
		await this.setPointerPreference('hideCaretWhileDragSelecting', enabled);
	}

	private async setPointerPreference(key: 'disableSelectedTextDrag' | 'hideCaretWhileDragSelecting', enabled: boolean): Promise<void> {
		const update = this.settingsUpdate.then(async () => {
			if (!this.editorLifecycle) throw new Error('ParaFlow lifecycle is not initialized');
			if (enabled === this.settings[key]) return;
			const nextSettings: ParaFlowSettings = { ...this.settings, [key]: enabled };
			await this.saveData(nextSettings);
			this.settings = nextSettings;
			this.app.workspace.updateOptions();
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

	async setBreakMarkersEnabled(enabled: boolean): Promise<void> {
		const update = this.settingsUpdate.then(async () => {
			const lifecycle = this.editorLifecycle;
			if (!lifecycle) throw new Error('ParaFlow lifecycle is not initialized');
			if (enabled === this.settings.breakMarkersEnabled) return;
			const nextSettings = { ...this.settings, breakMarkersEnabled: enabled };
			await this.saveData(nextSettings);
			lifecycle.setEnabled('break-markers', enabled);
			this.settings = nextSettings;
		});
		this.settingsUpdate = update.catch(() => undefined);
		await update;
	}

	async setLineBreakMarkersEnabled(kind: LineBreakKind, enabled: boolean): Promise<void> {
		const key = kind === 'html' ? 'htmlBreakMarkersEnabled' : 'hardBreakMarkersEnabled';
		const update = this.settingsUpdate.then(async () => {
			const lifecycle = this.editorLifecycle;
			if (!lifecycle) throw new Error('ParaFlow lifecycle is not initialized');
			if (enabled === this.settings[key]) return;
			const previous = this.settings;
			const nextSettings: ParaFlowSettings = {
				...previous,
				[key]: enabled,
			};
			await this.saveData(nextSettings);
			this.settings = nextSettings;
			try {
				lifecycle.refresh('break-markers');
			} catch (error) {
				this.settings = previous;
				throw error;
			}
		});
		this.settingsUpdate = update.catch(() => undefined);
		await update;
	}
}
