import { createDetachedEl } from '../../dom';
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { Prec, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import { parser } from '@lezer/markdown';
import { metadataGrammar, nativeInlineGrammarFor, standaloneBreakGrammar } from '../markdown-grammar.js';
import { mathRangeIndex } from '../math/syntax.js';
import { bindRenderedSourceClick, createRenderedSourceClickExtension } from '../runtime/rendered-source-click.js';
import { createRenderedSourceNavigation, renderedSourceHit, type VisualPosition } from '../runtime/navigation-core.js';
import { createNativeDecorationOwnership, nativeBlockOwnership, nativeInlineOwnership, isNativeReplacement } from '../runtime/native-decoration-ownership.js';
import {nativeCellSourceEditing} from '../table/native-cell-source.js';

const lineBreakOwners = new WeakMap<EditorView, () => boolean>();

const htmlBreak = /^<br[ \t]*\/?[ \t]*>$/iu;
const breakGrammar = parser.configure([metadataGrammar, standaloneBreakGrammar]);

export type LineBreakKind = 'hard' | 'html';

export interface LineBreakProjectionEntry {
	readonly from: number;
	readonly kind: LineBreakKind;
	readonly to: number;
}

export interface LineBreakProjectionState {
	readonly complete: boolean;
	readonly entries: readonly LineBreakProjectionEntry[];
}

interface LineBreakFieldState extends LineBreakProjectionState {
	readonly tree: Tree;
	readonly decorationsByOptions: readonly DecorationSet[];
}

class LineBreakWidget extends WidgetType {
	private static readonly cleanups = new WeakMap<HTMLElement, () => void>();
	constructor(private readonly kind: LineBreakKind, private readonly text: string, private readonly from = 0) { super(); }

	eq(other: WidgetType): boolean {
		return other instanceof LineBreakWidget && other.kind === this.kind &&
			other.text === this.text && other.from === this.from;
	}

	ignoreEvent(): boolean { return this.kind === 'hard'; }

	toDOM(view: EditorView): HTMLElement {
		const document = view.dom.ownerDocument;
		const root = createDetachedEl(document, 'span');
		root.className = 'paraflow-line-break-marker' + (this.kind === 'html' ? ' paraflow-html-break-hint' : '');
		root.dataset.breakKind = this.kind;
		root.setAttribute('aria-hidden', 'true');
		root.textContent = this.text;
		if (this.kind === 'html') {
			root.dataset.breakFrom = String(this.from);
			LineBreakWidget.cleanups.set(root, bindRenderedSourceClick(view, root, (node, offset) =>
				node === root.firstChild ? this.from + offset : node === root ? this.from + (offset ? this.text.length : 0) : null,
				() => lineBreakOwners.get(view)?.() ?? false));
		}
		return root;
	}
	coordsAt(dom: HTMLElement, position: number): DOMRect | null {
		return this.kind === 'html' ? sourceCharacterRect(dom, position) : null;
	}
	destroy(dom: HTMLElement): void {
		if (this.kind === 'html') { LineBreakWidget.cleanups.get(dom)!(); LineBreakWidget.cleanups.delete(dom); }
	}
}

function sourceCharacterRect(element: HTMLElement, offset: number): DOMRect {
	const range = element.ownerDocument.createRange();
	range.setStart(element.firstChild!, offset);
	range.collapse(true);
	return range.getBoundingClientRect();
}

function terminalBreakPosition(view: EditorView, node: Node, offset: number): number | null {
	const terminal = [...view.contentDOM.querySelectorAll<HTMLElement>('.paraflow-html-break-empty-line')]
		.find(element => element.closest('.cm-editor') === view.dom);
	if (!terminal) return null;
	if (node === terminal || terminal.contains(node)) return view.state.doc.length;
	const widget = terminal.parentElement!, line = widget.parentElement!;
	// Chromium resolves the empty visual row after the widget; the host CM may map it to the tag above.
	return node === line && offset > [...line.childNodes].indexOf(widget) ? view.state.doc.length : null;
}

function breakCharacterAt(view: EditorView, { x, y }: { x: number; y: number }): VisualPosition | null {
	for (const entry of requireLineBreakProjectionState(view.state).entries) {
		if (entry.kind !== 'html') continue;
		const hint = view.contentDOM.querySelector<HTMLElement>(`[data-break-from="${entry.from}"]`);
		if (!hint) continue;
		const rect = hint.getBoundingClientRect();
		if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
		let closest = 0;
		let distance = Infinity;
		for (let offset = 0; offset <= entry.to - entry.from; offset += 1) {
			const current = Math.abs(sourceCharacterRect(hint, offset).left - x);
			if (current < distance) { closest = offset; distance = current; }
		}
		return { position: entry.from + closest, assoc: 1 };
	}
	return null;
}

class HtmlBreakWidget extends WidgetType {
	constructor(private readonly terminal=false){super();}
	eq(other: WidgetType): boolean { return other instanceof HtmlBreakWidget&&other.terminal===this.terminal; }
	get lineBreaks(): number { return 1; }
	ignoreEvent(): boolean { return false; }
	toDOM(view: EditorView): HTMLElement {
		const root = createDetachedEl(view.dom.ownerDocument, 'span');
		root.className = 'paraflow-html-break';
		root.append(createDetachedEl(view.dom.ownerDocument, 'br'));
		if(this.terminal){
			const line=createDetachedEl(view.dom.ownerDocument, 'span');line.className='paraflow-html-break-empty-line';
			root.append(line);
		}
		return root;
	}
}

export function discoverLineBreakEntries(state: EditorState): readonly LineBreakProjectionEntry[] {
	const excluded: Array<{ from: number; to: number }> = [];
	syntaxTree(state).iterate({ enter(node) {
		if (/(?:^|[ _])(?:math|comment)(?:$|[ _-])/u.test(node.name)) excluded.push({ from: node.from, to: node.to });
	} });
	const entries: LineBreakProjectionEntry[] = [];
	const source = state.doc.toString();
	const add = (from: number, to: number, kind: LineBreakKind): void => {
		if (!excluded.some(range => range.from < to && from < range.to)) entries.push({ from, to, kind });
	};
	// A document parse retains source coordinates through list/quote prefixes and
	// excludes literal code, math and comments before their contents are visited.
	breakGrammar.configure(nativeInlineGrammarFor(mathRangeIndex(state).expressions)).parse(source).iterate({ enter(node) {
		if (node.name === 'HardBreak') add(node.from, node.to - 1, 'hard');
		else if (node.name === 'HTMLTag' && htmlBreak.test(source.slice(node.from, node.to))) add(node.from, node.to, 'html');
		else if (node.name === 'StandaloneBreaks') {
			for (const match of source.slice(node.from, node.to).matchAll(/<br[ \t]*\/?[ \t]*>/giu))
				add(node.from + match.index, node.from + match.index + match[0].length, 'html');
		}
	} });
	return Object.freeze(entries);
}

function project(state: EditorState, entries: readonly LineBreakProjectionEntry[], options: number): DecorationSet {
	const decorations: Range<Decoration>[] = [];
	for (const entry of entries) {
		if (entry.kind === 'hard') {
			if (options & 1) decorations.push(Decoration.widget({ side: 1,
				widget: new LineBreakWidget('hard', '↓') }).range(entry.to));
			continue;
		}
		const active = (options & 4) !== 0 && state.selection.ranges.some(range =>
			range.empty && entry.from <= range.head && range.head <= entry.to);
		if (active) {
			decorations.push(Decoration.mark({ class: 'paraflow-html-break-source paraflow-html-break-hint' }).range(entry.from, entry.to));
		} else {
			decorations.push(Decoration.replace({ widget: options & 2 ?
				new LineBreakWidget('html', state.doc.sliceString(entry.from, entry.to), entry.from) : undefined }).range(entry.from, entry.to));
		}
		// Source editing and hint visibility must not change the owner of the break.
		// A physical newline directly after the tag already supplies that break.
		if (entry.to === state.doc.length || state.doc.lineAt(entry.to).to !== entry.to) {
			decorations.push(Decoration.widget({ side: -1, widget: new HtmlBreakWidget(entry.to===state.doc.length) }).range(entry.to));
		}
	}
	return Decoration.set(decorations, true);
}

function build(state: EditorState, previous?: LineBreakFieldState): LineBreakFieldState {
	const tree = syntaxTree(state);
	const complete = syntaxTreeAvailable(state, state.doc.length);
	const entries = previous?.entries ?? (complete ? discoverLineBreakEntries(state) : []);
	return Object.freeze({ complete, entries, tree,
		decorationsByOptions: [0, 1, 2, 3, 4, 5, 6, 7].map(options => project(state, entries, options)),
	});
}

export const lineBreakProjectionField = StateField.define<LineBreakFieldState>({
	create: build,
	update(value, transaction) {
		if (!transaction.docChanged && value.tree === syntaxTree(transaction.state) &&
			value.complete === syntaxTreeAvailable(transaction.state, transaction.state.doc.length)) {
			return transaction.selection ? build(transaction.state, value) : value;
		}
		return build(transaction.state);
	},
});

export function getLineBreakProjectionState(state: EditorState): LineBreakProjectionState | null {
	return state.field(lineBreakProjectionField, false) ?? null;
}

export function requireLineBreakProjectionState(state: EditorState): LineBreakFieldState {
	const value = state.field(lineBreakProjectionField, false);
	if (!value) throw new Error('Line-break projection state is required');
	return value;
}

export function createLineBreakProjection(
	isPrimaryActive: (view: EditorView) => boolean,
	markersEnabled: (kind: LineBreakKind) => boolean = () => true,
): Extension {
	const isActive=(view:EditorView)=>isPrimaryActive(view)||view.state.facet(nativeCellSourceEditing);
	const owner = (state: EditorState, view: EditorView) => {
		if (!isActive(view)) return null;
		const entries = requireLineBreakProjectionState(state).entries.filter(entry => entry.kind === 'html');
		return (from: number, to: number, decoration: Decoration) => isNativeReplacement(decoration) &&
			entries.some(entry => entry.from <= from && to <= entry.to);
	};
	return [
		lineBreakProjectionField,
		EditorView.baseTheme({'.paraflow-html-break-empty-line':{display:'inline-block',width:'0',height:'1lh',verticalAlign:'top'}}),
		createNativeDecorationOwnership(), nativeBlockOwnership.of(owner), nativeInlineOwnership.of(owner),
		createRenderedSourceNavigation(),
		createRenderedSourceClickExtension(),
		ViewPlugin.define(view => {
			lineBreakOwners.set(view, () => isActive(view));
			const unbindTerminal = bindRenderedSourceClick(view, view.contentDOM,
				(node, offset) => terminalBreakPosition(view, node, offset), () => isActive(view));
			const initiallyActive = isActive(view);
			let destroyed = false;
			// CodeMirror adds editor DOM attributes after its first decoration pass.
			queueMicrotask(() => {
				if (!destroyed && initiallyActive !== isActive(view)) view.dispatch({});
			});
			return { destroy() { destroyed = true; unbindTerminal(); lineBreakOwners.delete(view); } };
		}),
		renderedSourceHit.of((view, coordinates) => isActive(view) && markersEnabled('html')
			? breakCharacterAt(view, coordinates) : null),
		// Blurred editors retain native HTML replacements, so keep our hint there.
		Prec.highest(EditorView.decorations.of(view => isActive(view)
			? requireLineBreakProjectionState(view.state).decorationsByOptions[(markersEnabled('hard') ? 1 : 0) |
				(markersEnabled('html') ? 2 : 0) | (view.hasFocus ? 4 : 0)]!
			: Decoration.none)),
	];
}
