import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { RangeSet, RangeValue, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import type { ParagraphBlock } from './model.js';
import { discoverParagraphAuthority, inlineHtmlBreakRangeForNode } from './syntax.js';

export type LineBreakKind = 'hard' | 'html';

export interface LineBreakProjectionEntry {
	readonly from: number;
	readonly kind: LineBreakKind;
	readonly to: number;
}

export interface LineBreakProjectionState {
	readonly atomicRanges: RangeSet<RangeValue>;
	readonly complete: boolean;
	readonly decorations: DecorationSet;
	readonly entries: readonly LineBreakProjectionEntry[];
}

interface LineBreakFieldState extends LineBreakProjectionState {
	readonly tree: Tree;
}

class LineBreakRangeValue extends RangeValue {}

class LineBreakWidget extends WidgetType {
	constructor(private readonly kind: LineBreakKind) { super(); }

	eq(other: WidgetType): boolean {
		return other instanceof LineBreakWidget && other.kind === this.kind;
	}

	ignoreEvent(): boolean { return true; }

	toDOM(): HTMLElement {
		const marker = createSpan();
		marker.className = 'paraflow-line-break-marker';
		marker.dataset.breakKind = this.kind;
		marker.setAttribute('aria-hidden', 'true');
		marker.textContent = this.kind === 'html' ? '<br>' : '↓';
		return marker;
	}
}

function containingParagraph(
	paragraphs: readonly ParagraphBlock[],
	from: number,
	to: number,
): boolean {
	return paragraphs.some((paragraph) => paragraph.from <= from && to <= paragraph.to);
}

function hardBreaks(
	state: EditorState,
	paragraphs: readonly ParagraphBlock[],
): readonly LineBreakProjectionEntry[] {
	const entries: LineBreakProjectionEntry[] = [];
	for (const paragraph of paragraphs) {
		const firstLine = state.doc.lineAt(paragraph.from).number;
		const lastLine = state.doc.lineAt(paragraph.to).number;
		for (let lineNumber = firstLine; lineNumber < lastLine; lineNumber += 1) {
			const line = state.doc.line(lineNumber);
			const suffix = / {2,}$/u.exec(line.text)?.[0];
			if (!suffix) continue;
			entries.push({ from: line.to - suffix.length, kind: 'hard', to: line.to });
		}
	}
	return entries;
}

function htmlBreaks(
	state: EditorState,
	paragraphs: readonly ParagraphBlock[],
): readonly LineBreakProjectionEntry[] {
	const entries = new Map<string, LineBreakProjectionEntry>();
	syntaxTree(state).iterate({
		enter: (node) => {
			const range = inlineHtmlBreakRangeForNode(state, node.node);
			if (!range || !containingParagraph(paragraphs, range.from, range.to)) return;
			entries.set(`${range.from}:${range.to}`, { ...range, kind: 'html' });
		},
	});
	return [...entries.values()];
}

function build(state: EditorState): LineBreakFieldState {
	const tree = syntaxTree(state);
	const complete = syntaxTreeAvailable(state, state.doc.length);
	const authority = complete ? discoverParagraphAuthority(state) : null;
	const entries = authority?.complete
		? [...hardBreaks(state, authority.paragraphs), ...htmlBreaks(state, authority.paragraphs)]
			.sort((left, right) => left.from - right.from || left.to - right.to)
		: [];
	const decorationRanges = entries.flatMap((entry) => entry.kind === 'html'
		? [Decoration.widget({ side: -1, widget: new LineBreakWidget(entry.kind) }).range(entry.from)]
		: [Decoration.replace({ widget: new LineBreakWidget(entry.kind) }).range(entry.from, entry.to)]);
	return Object.freeze({
		atomicRanges: RangeSet.of(entries.map((entry) =>
			new LineBreakRangeValue().range(entry.from, entry.to)), true),
		complete,
		decorations: Decoration.set(decorationRanges, true),
		entries: Object.freeze(entries),
		tree,
	});
}

export const lineBreakProjectionField = StateField.define<LineBreakFieldState>({
	create: build,
	update(value, transaction) {
		const tree = syntaxTree(transaction.state);
		if (!transaction.docChanged && value.tree === tree &&
			value.complete === syntaxTreeAvailable(transaction.state, transaction.state.doc.length)) {
			return value;
		}
		return build(transaction.state);
	},
});

export function getLineBreakProjectionState(state: EditorState): LineBreakProjectionState | null {
	return state.field(lineBreakProjectionField, false) ?? null;
}

export function requireLineBreakProjectionState(state: EditorState): LineBreakProjectionState {
	const value = getLineBreakProjectionState(state);
	if (!value) throw new Error('Line-break projection state is required');
	return value;
}

export function createLineBreakProjection(
	isActive: (view: EditorView) => boolean,
	markersEnabled: () => boolean = () => true,
): Extension {
	return [
		lineBreakProjectionField,
		EditorView.decorations.of((view) =>
			isActive(view) && markersEnabled()
				? requireLineBreakProjectionState(view.state).decorations
				: Decoration.none),
		EditorView.atomicRanges.of((view) =>
			isActive(view) && markersEnabled()
				? requireLineBreakProjectionState(view.state).atomicRanges
				: RangeSet.empty),
	];
}
