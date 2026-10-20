import { StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

interface SourceBlockAnchor { from: number; offset: number; valid(): boolean; restored(): void; }
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
	const origin = view.documentTop + view.scrollDOM.scrollTop - view.scrollDOM.getBoundingClientRect().top;
	view.scrollDOM.scrollTop = origin + view.lineBlockAt(anchor.from).top - anchor.offset;
	anchor.restored();
	return true;
})];
