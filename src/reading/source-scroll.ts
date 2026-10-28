import { StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

interface SourceBlockAnchor { from: number; offset: number; cursor?: boolean; valid(): boolean; restored(): void; }
export const restoreSourceBlock = StateEffect.define<SourceBlockAnchor | null>();
const target = StateField.define<SourceBlockAnchor | null>({
	create: () => null,
	update(value, transaction) {
		for (const effect of transaction.effects) if (effect.is(restoreSourceBlock)) return effect.value;
		return value;
	},
});

/** CM measures the target viewport before asking this owner for the first scroll. */
const consumed = new WeakSet<SourceBlockAnchor>();
export const sourceBlockScroll = [target, EditorView.scrollHandler.of((view, range) => {
	const anchor = view.state.field(target);
	if (!anchor || consumed.has(anchor) || anchor.from !== range.head) return false;
	consumed.add(anchor);
	if (!anchor.valid()) return true;
	if (anchor.cursor) {
		// Scroll handlers run in CM's write phase; caret geometry belongs to a measure read.
		view.requestMeasure({ key: anchor,
			read: () => anchor.valid() ? view.scrollDOM.scrollTop + view.coordsAtPos(anchor.from)!.top -
				view.scrollDOM.getBoundingClientRect().top - anchor.offset : null,
			write: top => { if (top !== null && anchor.valid()) { view.scrollDOM.scrollTop = top; anchor.restored(); } },
		});
		return true;
	}
	const viewportTop = view.scrollDOM.getBoundingClientRect().top;
	const top = view.documentTop + view.lineBlockAt(anchor.from).top - viewportTop;
	view.scrollDOM.scrollTop += top - anchor.offset;
	anchor.restored();
	return true;
})];
