import { createDetachedEl } from '../../dom';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';
import { WidgetType, type EditorView } from '@codemirror/view';
import { bindRenderedSourceClick } from '../runtime/rendered-source-click.js';

interface Span { readonly from: number; readonly to: number }
interface CorrectionRange extends Span { readonly literal?: boolean }
const markdown = parser.configure(GFM);

/** Limit the correction to native strike runs introduced by an invalid tilde-only marker. */
export function malformedNativeStrikeRanges(state: EditorState, visibleRanges: readonly Span[]): CorrectionRange[] {
	const result: CorrectionRange[] = [];
	const lines = new Map<number, { valid: Span[]; protected: Span[] }>();
	let correctedTo = -1;
	for (const visible of visibleRanges) syntaxTree(state).iterate({
		from: state.doc.lineAt(visible.from).from,
		to: state.doc.lineAt(visible.to).to,
		enter(ref) {
			const tokens = ref.name.toLowerCase().split(/[\s_]+/u);
			if (ref.from < correctedTo || !tokens.includes('formatting-strikethrough') ||
				tokens.some(token => token.includes('code') || token.includes('escape')) ||
				!/^~{4,}$/u.test(state.sliceDoc(ref.from, ref.to))) return;
			const line = state.doc.lineAt(ref.from);
			let source = lines.get(line.from);
			if (!source) {
				source = { valid: [], protected: [] };
				const classification = source;
				markdown.parse(line.text).iterate({ enter(node) {
					const span = { from: line.from + node.from, to: line.from + node.to };
					if (node.name === 'Strikethrough') classification.valid.push(span);
					if (['Strikethrough', 'InlineCode', 'FencedCode', 'CodeBlock', 'Escape'].includes(node.name)) classification.protected.push(span);
				} });
				lines.set(line.from, source);
			}
			if (source.protected.some(span => span.from < ref.to && ref.from < span.to)) return;
			for (let node: SyntaxNode | null = ref.node; node && node.to <= line.to; node = node.nextSibling) {
				if (!node.name.toLowerCase().split(/[\s_]+/u).includes('strikethrough')) break;
				let from = node.from;
				for (const valid of source.valid) {
					if (valid.to <= from || valid.from >= node.to) continue;
					if (from < valid.from) result.push({ from, to: valid.from });
					from = Math.max(from, valid.to);
				}
				if (from < node.to) result.push({ from, to: node.to, literal: node.from === ref.from });
				correctedTo = node.to;
				if (!node.nextSibling || node.nextSibling.from !== node.to) break;
			}
		},
	});
	return result;
}

/** Replace the host's empty delimiter widget with its literal text, without duplicating source. */
export class LiteralStrikeWidget extends WidgetType {
	private static readonly cleanups = new WeakMap<HTMLElement, () => void>();
	constructor(private readonly from: number, private readonly text: string, private readonly isOwnerActive: () => boolean) { super(); }
	eq(other: LiteralStrikeWidget): boolean {
		return this.from === other.from && this.text === other.text && this.isOwnerActive === other.isOwnerActive;
	}
	toDOM(view: EditorView): HTMLElement {
		const element = createDetachedEl(view.dom.ownerDocument, 'span');
		element.className = 'paraflow-invalid-native-strike';
		element.dataset.paraflowLiteralStrike = '';
		element.textContent = this.text;
		LiteralStrikeWidget.cleanups.set(element, bindRenderedSourceClick(view, element, (node, offset) =>
			node === element.firstChild ? this.from + offset : null, this.isOwnerActive));
		return element;
	}
	destroy(dom: HTMLElement): void { LiteralStrikeWidget.cleanups.get(dom)!(); LiteralStrikeWidget.cleanups.delete(dom); }
	ignoreEvent(): boolean { return false; }
}
