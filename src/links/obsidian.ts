import type { EditorView } from '@codemirror/view';
import { editorInfoField, getLanguage, MarkdownView, Notice, parseLinktext, type App, type WorkspaceLeaf } from 'obsidian';
import { createLinkNavigation, type LinkOrigin } from './navigation.js';
import type { LinkOpenIntent } from './intent.js';

export function createObsidianLinkNavigation(app: App, preventImplicitCreation: () => boolean) {
	const navigation = createLinkNavigation<WorkspaceLeaf, NonNullable<ReturnType<typeof app.metadataCache.getFirstLinkpathDest>>>({
		preventImplicitCreation,
		parseLinktext,
		resolveFile: (path, sourcePath) => app.metadataCache.getFirstLinkpathDest(path, sourcePath),
		notifyMissing: () => { new Notice(getLanguage().startsWith('zh') ? '链接目标尚未创建。' : 'This link target does not exist.'); },
		openInternal: async (destination, origin, intent, file, subpath) => {
			if (intent === 'current' && file && !origin.leaf.getViewState().pinned) {
				await origin.leaf.openFile(file, { active: true, eState: { subpath } });
				return;
			}
			app.workspace.setActiveLeaf(origin.leaf, { focus: false });
			await app.workspace.openLinkText(destination, origin.sourcePath, intent === 'current' ? false : intent, intent === 'tab' ? { active: true } : undefined);
		},
	});
	const fromEditor = (view: EditorView): LinkOrigin<WorkspaceLeaf> => {
		let source: WorkspaceLeaf | null = null;
		app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(view.dom)) source = leaf;
		});
		if (!source) throw new Error('Link source editor has no Markdown leaf');
		return { leaf: source, sourcePath: view.state.field(editorInfoField).file?.path ?? '', window: view.dom.ownerDocument.defaultView! };
	};
	return {
		...navigation,
		fromEditor,
		openFromEditor: (destination: string, view: EditorView, intent: LinkOpenIntent) => navigation.openAutomatic(destination, fromEditor(view), intent),
	};
}
