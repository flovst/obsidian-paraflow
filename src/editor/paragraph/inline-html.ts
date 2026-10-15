import type { EditorState } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { InlineSemanticConstruct } from './inline-selection-projection.js';
import { bindRenderedSourceClick } from '../runtime/rendered-source-click.js';

export type InlineHtmlRenderer = (
	source: string,
	container: HTMLElement,
	view: EditorView,
) => () => void;

const inlineTags = new Set(['abbr', 'b', 'del', 'em', 'i', 'ins', 'kbd', 'mark', 's', 'small', 'span', 'strong', 'sub', 'sup', 'u']);

export function inlineHtmlConstruct(state: EditorState, node: SyntaxNode): InlineSemanticConstruct | null {
	if (node.name !== 'HTMLTag' && !node.name.toLowerCase().includes('hmd-html')) return null;
	const line = state.doc.lineAt(node.from);
	const source = state.sliceDoc(node.from, line.to);
	const opening = /^<([a-z][a-z0-9]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/iu.exec(source);
	if (!opening || !inlineTags.has(opening[1]!.toLowerCase()) || opening[0].endsWith('/>')) return null;
	const tags = /<\/?([a-z][a-z0-9]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/giu;
	const stack: { name: string; from: number }[] = [];
	const sourceRanges: { from: number; to: number; kind: 'delimiter' }[] = [];
	const htmlBodies: { from: number; to: number; tagName: string }[] = [];
	for (const match of source.matchAll(tags)) {
		const name = match[1]!.toLowerCase();
		if (!inlineTags.has(name)) return null;
		const from = node.from + match.index;
		const to = from + match[0].length;
		sourceRanges.push({ from, to, kind: 'delimiter' });
		if (match[0].startsWith('</')) {
			const openingTag = stack.pop();
			if (openingTag?.name !== name) return null;
			htmlBodies.push({ from: openingTag.from, to: from, tagName: name });
			if (stack.length === 0) {
				// Only source tags are syntax; text keeps its semantic HTML element while editing.
				return { editFrom: node.from, editTo: to, kind: 'inline-html', sourceRanges, htmlBodies };
			}
		} else {
			if (match[0].endsWith('/>')) return null;
			stack.push({ name, from: to });
		}
	}
	return null;
}

export class InlineHtmlWidget extends WidgetType {
	private static readonly cleanups = new WeakMap<HTMLElement, () => void>();

	constructor(private readonly source: string, private readonly render: InlineHtmlRenderer, private readonly from: number,
		private readonly isOwnerActive: () => boolean) { super(); }

	eq(other: InlineHtmlWidget): boolean {
		return this.source === other.source && this.render === other.render && this.from === other.from && this.isOwnerActive === other.isOwnerActive;
	}

	toDOM(view: EditorView): HTMLElement {
		const container = view.dom.ownerDocument.createElement('span');
		container.className = 'paraflow-inline-html';
		const disposeRender = this.render(this.source, container, view);
		const mapping = htmlTextSourceMap(this.source, container.ownerDocument);
		const disposeClick = bindRenderedSourceClick(view, container, (node, offset) => {
			const range = container.ownerDocument.createRange();
			range.selectNodeContents(container);
			range.setEnd(node, offset);
			const length = range.toString().length;
			const sourceOffset = offset === 0 ? mapping[length]?.from : mapping[length - 1]?.to;
			return sourceOffset === undefined ? null : this.from + sourceOffset;
		}, this.isOwnerActive);
		InlineHtmlWidget.cleanups.set(container, () => { disposeClick(); disposeRender(); });
		return container;
	}

	destroy(dom: HTMLElement): void {
		InlineHtmlWidget.cleanups.get(dom)!();
		InlineHtmlWidget.cleanups.delete(dom);
	}

	ignoreEvent(): boolean { return false; }
}

function htmlTextSourceMap(source: string, doc: Document): { from: number; to: number }[] {
	const map: { from: number; to: number }[] = [];
	const decoder = new doc.defaultView!.DOMParser();
	const tokens = /<!--[\s\S]*?-->|<\/?[a-z][a-z0-9]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>|&(?:#x[\da-f]+|#\d+|[a-z][a-z\d]*);?|[\s\S]/giu;
	for (const match of source.matchAll(tokens)) {
		const token = match[0];
		if (token.startsWith('<') && token.length > 1) continue;
		const text = token.startsWith('&') && token.length > 1
			? decoder.parseFromString(`<span>${token}</span>`, 'text/html').body.textContent : token;
		let suffix = 0;
		if (text !== token) {
			while (suffix < text.length && text[text.length - suffix - 1] === token[token.length - suffix - 1]) suffix += 1;
		}
		for (let index = 0; index < text.length; index += 1) {
			const literal = text === token ? index : index >= text.length - suffix ? token.length - text.length + index : null;
			map.push(literal !== null ? { from: match.index + literal, to: match.index + literal + 1 }
				: { from: match.index, to: match.index + token.length - suffix });
		}
	}
	return map;
}
