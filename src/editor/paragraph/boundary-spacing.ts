import { Facet, Prec, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { paragraphBoundaryTag } from './model.js';
import { requireParagraphProjectionState, type ParagraphProjectionState } from './projection.js';

export const blockBoundarySpacingActive = Facet.define<boolean, boolean>({ combine: values => values.some(Boolean) });

class BlockBoundaryGap extends WidgetType {
	constructor(readonly before: string, readonly after: string) { super(); }
	eq(other: BlockBoundaryGap): boolean { return this.before === other.before && this.after === other.after; }
	toDOM(view: EditorView): HTMLElement {
		const gap = view.dom.ownerDocument.createElement('div');
		gap.className = 'paraflow-block-boundary-gap';
		gap.dataset.paraflowBefore = this.before;
		gap.dataset.paraflowAfter = this.after;
		gap.setAttribute('aria-hidden', 'true');
		return gap;
	}
	ignoreEvent(): boolean { return false; }
}

function build(state: EditorState, projection: ParagraphProjectionState): DecorationSet {
	const ranges: Range<Decoration>[] = [];
	const blocks = projection.authority.blocks;
	for (let index = 1; index < blocks.length; index += 1) {
		const before = blocks[index - 1]!;
		const after = blocks[index]!;
		// Sibling items share list rhythm. Actual blank runs already have a gap owner.
		if (before.kind === 'list-item' && after.kind === 'list-item') continue;
		if (state.sliceDoc(before.to, after.from) !== '\n') continue;
		ranges.push(Decoration.widget({
			block: true, side: -1,
			widget: new BlockBoundaryGap(paragraphBoundaryTag(before), paragraphBoundaryTag(after)),
		}).range(after.from));
	}
	const last = blocks.at(-1);
	const trailing = projection.authority.runs.find(run => run.kind === 'trailing' && run.to - run.from === 1);
	if (last && trailing && last.to === trailing.from && last.kind !== 'paragraph') {
		ranges.push(Decoration.widget({ block: true, side: -1,
			widget: new BlockBoundaryGap(paragraphBoundaryTag(last), 'p'),
		}).range(trailing.to));
	}
	return Decoration.set(ranges, true);
}

/** Direct field decorations keep the gap outside host replacement widgets. */
export function createBlockBoundarySpacing(isActive: (state: EditorState) => boolean): Extension {
	const field = StateField.define<{
		projection: ParagraphProjectionState;
		active: boolean;
		decorations: DecorationSet;
	}>({
		create(state) {
			const projection = requireParagraphProjectionState(state);
			const active = isActive(state);
			return { projection, active, decorations: active ? build(state, projection) : Decoration.none };
		},
		update(value, tr) {
			const projection = requireParagraphProjectionState(tr.state);
			const active = isActive(tr.state);
			return projection === value.projection && active === value.active ? value : {
				projection, active, decorations: active ? build(tr.state, projection) : Decoration.none,
			};
		},
		provide: value => [EditorView.decorations.from(value, state => state.decorations),
			blockBoundarySpacingActive.from(value, state => state.active)],
	});
	return Prec.highest(field);
}
