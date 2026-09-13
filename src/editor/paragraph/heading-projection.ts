import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { RangeSet, RangeValue, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import type { AtxHeadingBlock } from './model.js';
import { discoverAtxHeadings } from './syntax.js';

export interface HeadingProjectionState {
	readonly atomicRanges: RangeSet<RangeValue>;
	readonly complete: boolean;
	readonly decorations: DecorationSet;
	readonly headings: readonly AtxHeadingBlock[];
}

interface HeadingFieldState extends HeadingProjectionState {
	readonly tree: Tree;
}

class HeadingPrefixRangeValue extends RangeValue {}

class HeadingMarkerWidget extends WidgetType {
	constructor(private readonly level: AtxHeadingBlock['level']) { super(); }

	eq(other: WidgetType): boolean {
		return other instanceof HeadingMarkerWidget && other.level === this.level;
	}

	ignoreEvent(): boolean { return true; }

	toDOM(): HTMLElement {
		const marker = createSpan();
		marker.className = `paraflow-heading-marker paraflow-heading-marker--h${this.level}`;
		marker.setAttribute('aria-hidden', 'true');
		if (this.level >= 3) {
			const badge = marker.appendChild(createSpan());
			badge.className = 'paraflow-heading-badge';
			badge.textContent = `h${this.level}`;
		}
		return marker;
	}
}

function build(state: EditorState): HeadingFieldState {
	const tree = syntaxTree(state);
	const complete = syntaxTreeAvailable(state, state.doc.length);
	const headings = complete ? discoverAtxHeadings(state) : [];
	return Object.freeze({
		atomicRanges: RangeSet.of(headings.map((heading) =>
			new HeadingPrefixRangeValue().range(heading.prefixFrom, heading.prefixTo)), true),
		complete,
		decorations: Decoration.set(headings.map((heading) =>
			Decoration.replace({ widget: new HeadingMarkerWidget(heading.level) })
				.range(heading.prefixFrom, heading.prefixTo)), true),
		headings: Object.freeze(headings),
		tree,
	});
}

export const headingProjectionField = StateField.define<HeadingFieldState>({
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

export function getHeadingProjectionState(state: EditorState): HeadingProjectionState | null {
	return state.field(headingProjectionField, false) ?? null;
}

export function requireHeadingProjectionState(state: EditorState): HeadingProjectionState {
	const value = getHeadingProjectionState(state);
	if (!value) throw new Error('Heading projection state is required');
	return value;
}

export function headingAtCaret(
	state: EditorState,
	position: number,
): AtxHeadingBlock | null {
	const projection = requireHeadingProjectionState(state);
	if (!projection.complete) return null;
	return projection.headings.find((heading) =>
		heading.contentFrom <= position && position <= heading.to) ?? null;
}

export function normalizeHeadingSelectionEndpoint(
	state: EditorState,
	position: number,
	_bias: -1 | 1,
): number {
	const projection = getHeadingProjectionState(state);
	if (!projection?.complete) return position;
	const heading = projection.headings.find((candidate) =>
		candidate.prefixFrom <= position && position < candidate.contentFrom);
	if (!heading) return position;
	return heading.contentFrom;
}

export function createHeadingProjection(
	isActive: (view: EditorView) => boolean,
): Extension {
	return [
		headingProjectionField,
		EditorView.decorations.of((view) =>
			isActive(view) ? requireHeadingProjectionState(view.state).decorations : Decoration.none),
		EditorView.atomicRanges.of((view) =>
			isActive(view) ? requireHeadingProjectionState(view.state).atomicRanges : RangeSet.empty),
	];
}
