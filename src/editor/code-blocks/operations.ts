import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { classifyCurrentSelectionMode, compositionStateField, selectionModeAnnotation } from '../runtime/input-state.js';
import { adjacentBlock, blockContinuationPrefix } from '../runtime/block-body.js';
import { codeBlockEdit, discoverCodeBlocks } from './model.js';
import { codeMarkersActive } from './editable-boundaries.js';

export function deleteAdjacentCode(view: EditorView, forward: boolean): boolean {
	const state = view.state, selection = state.selection;
	if (!state.facet(codeMarkersActive) || state.readOnly || view.composing || state.field(compositionStateField, false) ||
		classifyCurrentSelectionMode(state) !== 'caret' || selection.ranges.length !== 1 || !selection.main.empty) return false;
	const blocks = discoverCodeBlocks(state).filter(block => block.closed && !block.indented).map(block => {
		const opening = state.doc.lineAt(block.from);
		return { ...block, from: opening.from + opening.text.search(/`{3,}|~{3,}/u) };
	});
	const adjacent = adjacentBlock(state, blocks, forward);
	if (!adjacent) return false;
	const { block, current, next } = adjacent, head = selection.main.head;
	const annotations = [codeBlockEdit.of(true), isolateHistory.of('full'), selectionModeAnnotation.of('normal')];
	if (forward) view.dispatch({ changes: { from: head, to: next?.from ?? block.to }, selection: { anchor: head },
		userEvent: 'delete.code-forward', annotations });
	else {
		const bodyTo = block.lines.at(-1)?.to ?? state.doc.lineAt(block.from).to;
		const prefix = block.lines.length ? '' : '\n' + blockContinuationPrefix(state, block.from);
		view.dispatch({ changes: [{ from: bodyTo, insert: prefix + state.sliceDoc(current.from, current.to) }, { from: block.to, to: current.to }],
			selection: { anchor: bodyTo + prefix.length }, userEvent: 'delete.code-backward', annotations });
	}
	return true;
}
