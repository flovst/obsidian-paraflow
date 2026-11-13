import { EditorView } from '@codemirror/view';
import { getLanguage, MarkdownView, Notice, parseLinktext, Platform, type Plugin, type WorkspaceLeaf } from 'obsidian';
import { destinationText, editableLinkAt } from '../editor/paragraph/link-interaction.js';
import { isExternalLink, linkOpenIntent, type LinkOpenIntent } from './intent.js';
import type { LinkOrigin } from './navigation.js';
import type { createObsidianLinkNavigation } from './obsidian.js';
import { showReadingLinkMenu } from './host-menu.js';
import { renderedLinkSourcePath } from './source-path.js';
import { registerNativeLinkCommandGuard } from './command-guard.js';

interface GuardOptions {
	preventImplicitCreation: () => boolean;
	editorOwnsLink: (view: EditorView) => boolean;
	tableOwnsLink: (target: Element) => boolean;
}

/** Native paths are intercepted before the host's mousedown handler can create a note. */
export function registerNativeLinkGuard(plugin: Plugin, navigation: ReturnType<typeof createObsidianLinkNavigation>, options: GuardOptions): void {
	registerNativeLinkCommandGuard(plugin, navigation, options.preventImplicitCreation);
	const documents = new WeakSet<Document>();
	const observe = (doc: Document) => {
		if (documents.has(doc)) return;
		documents.add(doc);
		let pending: { destination: string; missingSource: boolean; origin: LinkOrigin<WorkspaceLeaf>; intent: LinkOpenIntent; target: Node; x: number; y: number; cancelled: boolean } | null = null;
		const cancel = () => { if (pending) pending.cancelled = true; };
		const targetLink = (target: Element, deferEditor: boolean) => {
			if (target.closest('.footnote-link,.footnote-backref,.footnote-ref')) return null;
			let leaf: WorkspaceLeaf | null = null;
			plugin.app.workspace.iterateAllLeaves(candidate => {
				if (candidate.view instanceof MarkdownView && candidate.view.containerEl.contains(target)) leaf = candidate;
			});
			if (!leaf) return null;
			const sourceLeaf: WorkspaceLeaf = leaf;
			const markdown = sourceLeaf.view as MarkdownView;
			if (deferEditor && markdown.getMode() !== 'preview' && options.tableOwnsLink(target)) return null;
			const editorDOM = target.closest<HTMLElement>('.cm-editor');
			const editor = editorDOM ? EditorView.findFromDOM(editorDOM) : null;
			if (deferEditor && editor && !target.closest('.internal-embed,.cm-table-widget,.paraflow-html-table-editor') && options.editorOwnsLink(editor)) return null;
			const anchor = target.closest('a');
			let destination = anchor?.getAttribute('data-href') ?? anchor?.getAttribute('href');
			if (destination == null && editor) {
				const position = editor.posAtDOM(target);
				const source = editableLinkAt(editor.state, position);
				destination = source ? destinationText(source.destination, editor) : null;
			}
			if (destination == null || isExternalLink(destination)) return null;
			const sourcePath = renderedLinkSourcePath(target, markdown.containerEl, markdown.file?.path ?? '', parseLinktext,
				(path, source) => plugin.app.metadataCache.getFirstLinkpathDest(path, source));
			return { destination, missingSource: sourcePath === null, origin: { leaf: sourceLeaf, sourcePath: sourcePath ?? '', window: doc.defaultView! },
				reading: markdown.getMode() === 'preview', source: markdown.getMode() === 'source' && markdown.getState().source === true };
		};
		const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
		const sourceAvailable = (link: { missingSource: boolean }) => {
			if (!link.missingSource) return true;
			new Notice(getLanguage().startsWith('zh') ? '嵌入内容的来源笔记已不存在。' : 'The embedded source note no longer exists.');
			return false;
		};
		plugin.registerDomEvent(doc, 'mousedown', event => {
			pending = null;
			if (!options.preventImplicitCreation() || event.button > 1 || event.detail > 1) return;
			const target = event.target as Element | null;
			if (!target?.closest) return;
			const link = targetLink(target, event.button === 0);
			if (!link) return;
			const mod = Platform.isMacOS ? event.metaKey : event.ctrlKey;
			if (link.source && !(event.button === 1 || mod)) return;
			if (!link.reading && !link.source && !mod && event.button !== 1 && !target.closest('a,.cm-underline')) return;
			if (link.reading && !mod && (event.shiftKey || event.altKey) && event.button !== 1) return;
			if (!link.reading && !mod && (event.shiftKey || event.altKey) && event.button !== 1) return;
			stop(event);
			const intent = event.button === 1 ? 'tab' : mod ? link.source && !event.altKey && !event.shiftKey ? 'current' : linkOpenIntent(event) : 'current';
			pending = { ...link, intent, target, x: event.clientX, y: event.clientY, cancelled: false };
		}, true);
		plugin.registerDomEvent(doc, 'mousemove', event => {
			if (pending && Math.max(Math.abs(event.clientX - pending.x), Math.abs(event.clientY - pending.y)) > 4) pending.cancelled = true;
		}, true);
		const complete = (event: MouseEvent) => {
			const gesture = pending;
			if (!gesture) {
				const target = event.target as Element | null;
				if (event.type !== 'click' || event.detail !== 0 || !options.preventImplicitCreation() || !target?.closest('a')) return;
				const link = targetLink(target, false);
				if (!link) return;
				stop(event);
				if (sourceAvailable(link)) navigation.openAutomatic(link.destination, link.origin, 'current');
				return;
			}
			pending = null; stop(event);
			if (gesture.cancelled || event.detail > 1 || !(event.target instanceof doc.defaultView!.Node) ||
				!(gesture.target === event.target || (gesture.target as Element).contains(event.target))) return;
			if (sourceAvailable(gesture)) navigation.openAutomatic(gesture.destination, gesture.origin, gesture.intent);
		};
		plugin.registerDomEvent(doc, 'click', complete, true);
		plugin.registerDomEvent(doc, 'auxclick', complete, true);
		plugin.registerDomEvent(doc, 'pointercancel', cancel, true);
		plugin.registerDomEvent(doc, 'dragstart', cancel, true);
		const openLink = (event: Event) => {
			if (!options.preventImplicitCreation()) return;
			const target = event.target as Element | null;
			if (!target?.closest('a')) return;
			const link = targetLink(target, false);
			if (!link) return;
			const pane = (event as CustomEvent<{ paneType: false | 'tab' | 'split' | 'window' }>).detail.paneType;
			stop(event);
			if (sourceAvailable(link)) navigation.openAutomatic(link.destination, link.origin, pane || 'current');
		};
		doc.addEventListener('open-link', openLink, true);
		plugin.register(() => doc.removeEventListener('open-link', openLink, true));
		plugin.registerDomEvent(doc, 'contextmenu', event => {
			const target = event.target as Element | null;
			if (!target?.closest('a')) return;
			const link = targetLink(target, false);
			if (!link || !link.reading && !target.closest('.internal-embed')) return;
			stop(event);
			if (sourceAvailable(link)) showReadingLinkMenu(plugin, navigation, event, link.destination, link.origin);
		}, true);
		const win = doc.defaultView!;
		win.addEventListener('blur', cancel);
		plugin.register(() => win.removeEventListener('blur', cancel));
	};
	observe(document);
	const observeLeaves = () => plugin.app.workspace.iterateAllLeaves(leaf => observe(leaf.view.containerEl.ownerDocument));
	observeLeaves();
	plugin.registerEvent(plugin.app.workspace.on('layout-change', observeLeaves));
	plugin.registerEvent(plugin.app.workspace.on('window-open', (_workspaceWindow, win) => observe(win.document)));
}
