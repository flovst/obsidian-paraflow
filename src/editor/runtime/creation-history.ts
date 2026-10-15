import { invertedEffects } from '@codemirror/commands';
import { EditorState, Facet, StateEffect, Transaction, type Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import { selectionModeAnnotation } from './input-state.js';

export const creationHistory = StateEffect.define<{ owner: 'math' | 'code' | 'container'; from: number; draftOffset: number; bodyOffset: number; created: boolean }>({
	map: (value, changes) => ({ ...value, from: changes.mapPos(value.from) }),
});

const owners = Facet.define<{ owner: 'math' | 'code' | 'container'; isActive: (state: EditorState, view: EditorView) => boolean }>();
const replay: Extension = [invertedEffects.of(transaction => transaction.effects.filter(effect => effect.is(creationHistory))
		.map(effect => creationHistory.of({ ...effect.value,
			from: transaction.changes.invertedDesc.mapPos(effect.value.from), created: !effect.value.created }))),
		ViewPlugin.define(view => {
			let destroyed = false;
			return { update(update) {
				for (const transaction of update.transactions) {
					if (!transaction.isUserEvent('undo') && !transaction.isUserEvent('redo')) continue;
					const effect = transaction.effects.find(effect => effect.is(creationHistory));
					if (!effect) continue;
					const head = effect.value.from + (effect.value.created ? effect.value.bodyOffset : effect.value.draftOffset);
					queueMicrotask(() => {
						if (destroyed || !view.state.facet(owners).some(owner => owner.owner === effect.value.owner && owner.isActive(view.state, view)) || view.state.doc !== transaction.state.doc || !view.state.selection.eq(transaction.newSelection) || view.state.selection.main.head === head) return;
						view.dispatch({ selection: { anchor: head }, userEvent: 'select',
							annotations: [Transaction.addToHistory.of(false), selectionModeAnnotation.of('normal')] });
					});
				}
			}, destroy() { destroyed = true; } };
		})];

/** Native history may derive a redo caret by mapping the original end past the inserted block. */
export function createCreationHistory(owner: 'math' | 'code' | 'container', isActive: (state: EditorState, view: EditorView) => boolean): Extension {
	return [owners.of({ owner, isActive }), replay];
}
