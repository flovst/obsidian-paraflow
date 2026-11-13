import { EditorSelection, Prec, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { mathSyntaxTree } from '../math/semantic-tree.js';
import { handoffRenderedSourceGesture, isRenderedSourceGesture } from '../runtime/rendered-source-click.js';
import { discoverInlineSemanticConstructs } from './inline-selection-projection.js';
import { resolvedReferenceLinkAt } from './literal-reference.js';
import { inlineHtmlClickPosition } from './inline-html.js';
import { linkOpenIntent, type LinkOpenIntent } from '../../links/intent.js';

export interface LinkInteractionOptions {
	readonly editLinksOnPlainClick: () => boolean;
	readonly isActive: (view: EditorView) => boolean;
	readonly openReferenceLink?: (destination: string, view: EditorView, intent: LinkOpenIntent) => void;
}

export interface EditableLink {
	readonly from: number;
	readonly to: number;
	readonly destination: string;
	readonly kind: 'link' | 'wikilink' | 'reference' | 'autolink' | 'html-anchor';
}

/** Source ownership comes from the existing inline grammar and reference index. */
export function editableLinkAt(state: EditorState, position: number): EditableLink | null {
	const reference = resolvedReferenceLinkAt(state, position);
	if (reference) return { ...reference, kind: 'reference' };
	const tree = mathSyntaxTree(state);
	const constructs = discoverInlineSemanticConstructs(state, [EditorSelection.cursor(position)]);
	for (const item of constructs) {
		if (position < item.editFrom || position >= item.editTo) continue;
		const from = item.editFrom, to = item.editTo;
		if (item.kind === 'wikilink') return { from, to, kind: 'wikilink', destination: state.sliceDoc(from + 2, to - 2).split('|')[0]! };
		if (item.kind === 'inline-html') {
			const opening = /^<a\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/iu.exec(state.sliceDoc(from, to));
			const href = opening && /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(opening[0]);
			if (href) return { from, to, kind: 'html-anchor', destination: href[1] ?? href[2] ?? href[3]! };
		}
		if (item.kind !== 'link') continue;
		if (state.sliceDoc(from, from + 1) === '<') {
			const raw = state.sliceDoc(from + 1, to - 1);
			return { from, to, kind: 'autolink', destination: raw.includes('@') && !raw.includes(':') ? `mailto:${raw}` : raw };
		}
		const range = item.sourceRanges.find(range => range.kind === 'link-destination');
		let destination = '';
		if (range) tree.iterate({ from: range.from, to: range.to, enter(ref) {
			if (ref.from < range.from || ref.to > range.to) return;
			if (ref.name === 'URL' || ref.name.toLowerCase().split('_').some(token => token === 'url')) {
				destination += state.sliceDoc(ref.from, ref.to);
				return false;
			}
			return undefined;
		} });
		if (destination.startsWith('<') && destination.endsWith('>')) destination = destination.slice(1, -1);
		return { from, to, kind: 'link', destination };
	}
	let result: EditableLink | null = null;
	tree.iterate({ from: position, to: position, enter(ref) {
		if (ref.from > position || ref.to <= position) return false;
		if (ref.name === 'Autolink') {
			const url = ref.node.getChild('URL')!;
			const destination = state.sliceDoc(url.from, url.to);
			result = { from: ref.from, to: ref.to, kind: 'autolink', destination: destination.includes('@') && !destination.includes(':') ? `mailto:${destination}` : destination };
			return false;
		}
		const tokens = ref.name.toLowerCase().split('_');
		const nativeURL = ref.name !== 'URL' && tokens.includes('url') && !tokens.some(token => token === 'string' || token.startsWith('formatting') ||
			token.includes('footnote') || token.includes('footref') || token.includes('image') || token.includes('code') || token.includes('comment'));
		if ((ref.name === 'URL' && ref.node.parent?.name === 'Paragraph') || nativeURL) {
			const destination = state.sliceDoc(ref.from, ref.to);
			result = { from: ref.from, to: ref.to, kind: 'autolink', destination: destination.includes('@') && !destination.includes(':') ? `mailto:${destination}`
				: nativeURL && !/^[a-z][a-z\d+.-]*:/iu.test(destination) ? `https://${destination}` : destination };
		}
		return undefined;
	} });
	return result;
}

export function destinationText(source: string, view: EditorView): string {
	return source.replace(/\\([!-/:-@[-`{-~])|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]+);/gu, (token, escaped: string | undefined) =>
		escaped ?? new view.dom.ownerDocument.defaultView!.DOMParser().parseFromString(token, 'text/html').body.textContent);
}

interface PendingLinkGesture {
	readonly link: EditableLink;
	readonly x: number;
	readonly y: number;
	readonly intent: LinkOpenIntent | null;
	cancelled: boolean;
	completed: boolean;
}

export function createLinkInteraction(options: LinkInteractionOptions): Extension {
	const pending = new WeakMap<EditorView, PendingLinkGesture>();
	const lifecycle = ViewPlugin.define(view => {
		const doc = view.dom.ownerDocument;
		const cancel = (): void => { const gesture = pending.get(view); if (gesture) gesture.cancelled = true; };
		const move = (event: MouseEvent): void => {
			const gesture = pending.get(view);
			if (gesture && Math.max(Math.abs(event.clientX - gesture.x), Math.abs(event.clientY - gesture.y)) > 4) gesture.cancelled = true;
		};
		const release = (event: MouseEvent): void => {
			const gesture = pending.get(view);
			if (!gesture || gesture.completed) return;
			gesture.completed = true;
			move(event);
			if (!view.dom.contains(event.target as Node) || gesture.cancelled || event.button !== 0 || !gesture.intent || !options.isActive(view)) return;
			const position = inlineHtmlClickPosition(event) ?? view.posAtCoords({ x: event.clientX, y: event.clientY });
			const link = position === null ? null : editableLinkAt(view.state, position);
			if (link?.from === gesture.link.from && link.to === gesture.link.to && link.destination === gesture.link.destination) {
				options.openReferenceLink!(destinationText(link.destination, view), view, gesture.intent);
			}
		};
		const click = (event: MouseEvent): void => {
			if (!pending.has(view) || !view.dom.contains(event.target as Node)) return;
			pending.delete(view);
			event.preventDefault(); event.stopImmediatePropagation();
		};
		doc.addEventListener('click', click, true);
		doc.addEventListener('mouseup', release, true);
		doc.addEventListener('mousemove', move, true);
		doc.addEventListener('pointercancel', cancel, true);
		view.dom.addEventListener('compositionstart', cancel, true);
		doc.defaultView!.addEventListener('blur', cancel);
		return { update(update) { if (update.docChanged || update.transactions.some(transaction => transaction.reconfigured)) cancel(); }, destroy() {
			pending.delete(view);
			doc.removeEventListener('click', click, true);
			doc.removeEventListener('mouseup', release, true);
			doc.removeEventListener('mousemove', move, true);
			doc.removeEventListener('pointercancel', cancel, true);
			view.dom.removeEventListener('compositionstart', cancel, true);
			doc.defaultView!.removeEventListener('blur', cancel);
		} };
	});
	return [lifecycle, Prec.highest(EditorView.domEventHandlers({
		mousedown(event, view) {
			if (isRenderedSourceGesture(event)) return false;
			pending.delete(view);
			if (!options.isActive(view) || event.button !== 0 || view.composing) return false;
			const modified = event.ctrlKey || event.metaKey;
			if (modified && !options.openReferenceLink) return false;
			if (!modified && event.altKey) return false;
			const position = inlineHtmlClickPosition(event) ?? view.posAtCoords({ x: event.clientX, y: event.clientY });
			const link = position === null ? null : editableLinkAt(view.state, position);
			if (!link) return false;
			const edit = options.editLinksOnPlainClick();
			if (!edit && link.kind !== 'reference') return false;
			const intent = options.openReferenceLink && (modified || (!edit && !event.shiftKey)) ? (modified ? linkOpenIntent(event) : 'current') : null;
			if (!edit && !intent) return false;
			pending.set(view, { link, x: event.clientX, y: event.clientY, intent, cancelled: event.detail > 1, completed: false });
			handoffRenderedSourceGesture(view, event, position!, () => options.isActive(view));
			return true;
		},
	}))];
}
