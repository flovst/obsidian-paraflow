import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ParaFlowSettings } from '../settings.js';
import { createEditorExtensionLifecycle, type EditorExtensionLifecycleHost } from './extension-lifecycle.js';
import { createEditorRuntimeExtension } from './runtime/navigation-core.js';
import { createEditorPointerExtension } from './runtime/pointer.js';
import { createVirtualTailExtension } from './runtime/virtual-tail.js';
import { createParagraphExtension, type ParagraphExtensionOptions } from './paragraph/extension.js';
import { createLineBreakProjection } from './paragraph/line-break-projection.js';
import { createStructuredListExtension, createStructuredListRuntimeServiceFactory } from './structured-list/extension.js';
import { listSiblingGapProjection } from './structured-list/sibling-gaps.js';
import { renderedDOMOwnership } from './runtime/rendered-dom-ownership.js';
import { createCalloutExtension } from './callout/extension.js';
import { createCalloutPresentation, type CalloutPresentationOptions } from './callout/presentation.js';
import { createRenderedBlockEditing, type RenderedBlockEditingOptions } from './rendered-blocks/extension.js';
import { createDetailsEditing, type DetailsEditingState } from './rendered-blocks/details-extension.js';
import { createMarkdownPairingPolicy } from './markdown-pairing.js';
import { mathSourcePaletteExtension } from '../themes/math-palette.js';
import { codeSourcePaletteExtension } from '../themes/code-palette.js';
import { createSourceViewExtension } from './source-view.js';
import { createIndentMaintenanceSaveExtension } from './indent-maintenance-save.js';
import { planManualSaveMaintenance } from './manual-save-maintenance.js';
import { createClipboardPasteExtension } from './clipboard-paste.js';
import { createCommentExtension } from './comments.js';
import { createShorthandExtension } from './shorthand/extension.js';
import { createBodyLayoutExtension } from './body-layout.js';
import { createMediaTableDisplayExtension } from './media-table.js';
import { createCodeBlockExtension } from './code-blocks/index.js';
import { createHeadingEditing } from './paragraph/heading-editing.js';
import { createInlineSelectionProjection } from './paragraph/inline-selection-projection.js';
import { createLinkInteraction } from './paragraph/link-interaction.js';
import { createMathEditingExtension, createMathTabExtension } from './math/extension.js';
import { mathSemanticParseCache } from './math/semantic-tree.js';
import { createFootnoteExtension } from './footnotes/extension.js';
import { sourceBlockScroll } from '../reading/source-scroll.js';
import { createBlockMoveExtension } from './block-move.js';
import type { RegisterBlockMoveScope } from './block-move-scope.js';

/** Host services only: core extension construction and ordering stay here. */
export interface EditorCompositionDependencies {
	getSettings: () => ParaFlowSettings;
	isLivePreview: (state: EditorState) => boolean;
	isPrimaryLivePreviewEditor: (view: EditorView) => boolean;
	isPrimarySourceEditor: (view: EditorView) => boolean;
	isPrimarySourceState: (state: EditorState) => boolean;
	currentEditor: () => EditorView | null;
	saveEditor: (view: EditorView) => Promise<void>;
	notify: (message: string) => void;
	clipboard: Parameters<typeof createStructuredListRuntimeServiceFactory>[0]['clipboard'];
	mathRendering: ParagraphExtensionOptions['mathRendering'];
	renderInlineHtml: ParagraphExtensionOptions['renderInlineHtml'];
	openReferenceLink: ParagraphExtensionOptions['openReferenceLink'];
	renderMarkdown: RenderedBlockEditingOptions['renderMarkdown'];
	subscribeMarkdownChanges?: RenderedBlockEditingOptions['subscribeMarkdownChanges'];
	sourcePath: RenderedBlockEditingOptions['sourcePath'];
	detailsState?: DetailsEditingState;
	renderCalloutHeader: CalloutPresentationOptions['renderHeader'];
	loadPrism?: Parameters<typeof createCodeBlockExtension>[0]['loadPrism'];
	registerBlockMoveScope?: RegisterBlockMoveScope;
	tableEditingExtension: () => Extension | null;
}

export function createEditorComposition(host: EditorExtensionLifecycleHost, dependencies: EditorCompositionDependencies) {
	const { getSettings, isLivePreview, isPrimaryLivePreviewEditor, isPrimarySourceEditor } = dependencies;
	const isActive = (view: EditorView) => isLivePreview(view.state) && isPrimaryLivePreviewEditor(view);
	const isCurrentSourceEditor = (view: EditorView) => isPrimarySourceEditor(view) && dependencies.currentEditor() === view;
	const navigationCore = createEditorRuntimeExtension({ isSelectionPresentationActive: isPrimaryLivePreviewEditor, isSelectionPresentationStateActive: isLivePreview });
	// Host registration and removal must keep every owner together with its shared runtime.
	const extensionRoot: Extension[] = [mathSemanticParseCache, navigationCore, sourceBlockScroll];
	const moduleHost: EditorExtensionLifecycleHost = { registerEditorExtension: extension => { extensionRoot.push(extension); }, updateOptions: () => host.updateOptions() };
	const renderedBlocks = createRenderedBlockEditing({
		isStateActive: isLivePreview, isActive, isViewSupported: isPrimarySourceEditor,
		isKindEnabled: kind => kind === 'html' ? getSettings().enhancements.htmlBlocks : getSettings().enhancements.mermaid,
		getCodeLanguagePosition: () => getSettings().enhancements.codeLanguagePosition,
		sourcePath: dependencies.sourcePath, renderMarkdown: dependencies.renderMarkdown, subscribeMarkdownChanges: dependencies.subscribeMarkdownChanges,
	});
	const services = createStructuredListRuntimeServiceFactory({ clipboard: dependencies.clipboard });
	moduleHost.registerEditorExtension(createMathTabExtension(view =>
		getSettings().enhancements.math && !!dependencies.mathRendering && isActive(view)));
	// An inner quote edits its projected body before the outer list can consume the key.
	moduleHost.registerEditorExtension(createCalloutExtension(view => getSettings().enhancements.callout && isActive(view), {
		listEditing: () => getSettings().structuredListEditingEnabled,
		headingEditing: () => getSettings().enhancements.headings,
		paragraphEditing: () => getSettings().paragraphEditingEnabled,
	}));
	moduleHost.registerEditorExtension(createEditorPointerExtension({
		disableSelectedTextDrag: () => getSettings().disableSelectedTextDrag,
		hideCaretWhileDragSelecting: () => getSettings().hideCaretWhileDragSelecting,
		isActive: isPrimarySourceEditor, isLivePreview,
	}));
	moduleHost.registerEditorExtension(createVirtualTailExtension({ isActive, getOptions: () => ({
		keyboard: getSettings().enhancements.virtualLineKeyboard, pointer: getSettings().enhancements.virtualLinePointer,
	}) }));
	const settings = getSettings();
	const lifecycle = createEditorExtensionLifecycle(moduleHost, {
		navigationCore: () => [],
		paragraph: () => [createParagraphExtension({ isLivePreview, isSurface: isPrimaryLivePreviewEditor,
			isSurfaceState: dependencies.isPrimarySourceState,
			includeHeadings: false, includeInline: false }), createBodyLayoutExtension(isActive, () => getSettings().enhancements)],
		structuredList: () => createStructuredListExtension({ isLivePreview, isSurface: isPrimaryLivePreviewEditor, services }),
		breakMarkers: () => createLineBreakProjection(isActive,
			kind => kind === 'html' ? getSettings().htmlBreakMarkersEnabled : getSettings().hardBreakMarkersEnabled),
	}, {
		breakMarkers: settings.paragraphEditingEnabled,
		paragraph: settings.paragraphEditingEnabled,
		structuredList: settings.structuredListEditingEnabled,
	});
	const supplementalExtensions: Extension[] = [];
	function rebuildSupplementalExtensions(): void {
		const enhancements = getSettings().enhancements;
		const extensions: Extension[] = [
			createBlockMoveExtension(isActive, dependencies.registerBlockMoveScope),
			createMarkdownPairingPolicy(isPrimarySourceEditor),
			createSourceViewExtension({
				isSourceView: view => isPrimarySourceEditor(view) && !isLivePreview(view.state),
				getOptions: () => {
					const current = getSettings().enhancements;
					return {
						enabled: current.sourceView, activeLine: current.sourceActiveLine,
						whitespace: current.sourceWhitespace, indentGuides: current.sourceIndentGuides,
						lineNumbers: current.sourceLineNumbers, lineNumberStyle: current.sourceLineNumberStyle,
						lineNumberPosition: current.sourceLineNumberPosition,
						newlineMarkers: current.sourceNewlineMarkers, tabSize: current.sourceTabSize,
						scrollLimit: current.sourceScrollLimit,
					};
				},
			}),
			createIndentMaintenanceSaveExtension({
				getEnabled: () => getSettings().enhancements.maintainListIndentOnSave,
				isPrimaryEditor: isCurrentSourceEditor, plan: planManualSaveMaintenance,
				save: dependencies.saveEditor,
				onError: error => dependencies.notify(`正文边界、列表缩进整理或保存失败：${String(error)}`),
			}),
			createClipboardPasteExtension({
				isActive: view => getSettings().enhancements.clipboard && isCurrentSourceEditor(view), enabled: () => getSettings().enhancements.pasteCloseCodeFences,
				getMode: view => isLivePreview(view.state) ? getSettings().enhancements.livePreviewPasteMode : getSettings().enhancements.sourcePasteMode,
				notify: dependencies.notify,
			}),
		];
		extensions.push(renderedDOMOwnership);
		if (getSettings().paragraphEditingEnabled || getSettings().structuredListEditingEnabled || enhancements.callout) extensions.push(listSiblingGapProjection);
		if (enhancements.headings) extensions.push(createHeadingEditing(isActive, isLivePreview));
		if (enhancements.htmlBlocks || enhancements.mermaid) extensions.push(renderedBlocks);
		if (enhancements.htmlBlocks) extensions.push(createDetailsEditing(isLivePreview, () => getSettings().enhancements.detailsHoverBackground, dependencies.detailsState));
		if (enhancements.math) extensions.push(mathSourcePaletteExtension(enhancements.mathSourcePalette),
			dependencies.mathRendering ? createMathEditingExtension({ ...dependencies.mathRendering, isStateActive: isLivePreview }) : []);
		if (enhancements.inline) extensions.push(
			EditorView.editorAttributes.of(view => ({ class: isActive(view) ? 'paraflow-inline-active' : '' })),
			createInlineSelectionProjection(isLivePreview, isActive, dependencies.renderInlineHtml),
			createLinkInteraction({ isActive, editLinksOnPlainClick: () => getSettings().editLinksOnPlainClick, openReferenceLink: dependencies.openReferenceLink }),
			createCommentExtension({ isActive, getMode: () => getSettings().enhancements.commentDisplay }),
			createShorthandExtension({ isActive, getSettings: () => getSettings().enhancements }));
		if (enhancements.images || (enhancements.table && (enhancements.tableDisplay || enhancements.tableEditing))) extensions.push(
			createMediaTableDisplayExtension(view => isLivePreview(view.state), () => {
				const current = getSettings().enhancements;
				return { ...current, tableDisplay: current.table && current.tableDisplay, tableEditing: current.table && current.tableEditing,
					tableBreakHints: current.table && (current.tableDisplay || current.tableEditing) && getSettings().paragraphEditingEnabled && getSettings().htmlBreakMarkersEnabled };
			}));
		if (enhancements.code) extensions.push(codeSourcePaletteExtension(enhancements.codeSourcePalette), createCodeBlockExtension({ isActive, getOptions: () => getSettings().enhancements, loadPrism: dependencies.loadPrism }));
		if (enhancements.footnotes) extensions.push(createFootnoteExtension({ isActive,
			hideDefinitionMarkers: () => getSettings().enhancements.footnoteHideDefinitionMarkers, notify: dependencies.notify }));
		if (enhancements.callout) extensions.push(createCalloutPresentation({ isActive,
			getStyle: () => getSettings().enhancements.calloutStyle,
			isViewSupported: isPrimarySourceEditor, isActiveState: isLivePreview, renderHeader: dependencies.renderCalloutHeader }));
		const tableEditing = dependencies.tableEditingExtension();
		if (enhancements.table && enhancements.tableEditing && tableEditing) extensions.push(tableEditing);
		supplementalExtensions.splice(0, supplementalExtensions.length, ...extensions);
	}
	return {
		lifecycle,
		extensionRoot,
		supplementalExtensions,
		rebuildSupplementalExtensions,
		// Table integration is initialized after the stable editor modules in the host.
		registerSupplementalExtensions() {
			rebuildSupplementalExtensions();
			extensionRoot.push(supplementalExtensions);
			host.registerEditorExtension(extensionRoot);
		},
	};
}

export type EditorComposition = ReturnType<typeof createEditorComposition>;
