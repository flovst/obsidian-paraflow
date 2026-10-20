import { EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
import { keymap, EditorView } from '@codemirror/view';
import { createHeadingProjection, getHeadingProjectionState, normalizeHeadingSelectionEndpoint } from './heading-projection.js';
import { planHeadingBackspace, planHeadingEnter } from './operations.js';
import { dispatchParagraphEditPlan } from './edit-plan.js';
import { classifyCurrentSelectionMode, compositionStateField, excludedSelectionModeForTransaction, requireCompositionState, recognizedNormalSelectionTransaction } from '../runtime/input-state.js';

/** Heading ownership is independent of ordinary paragraph editing. */
export function createHeadingEditing(isActive: (view: EditorView) => boolean, isStateActive: (state: EditorState) => boolean): Extension {
	return [createHeadingProjection(isActive, isStateActive),
		EditorView.editorAttributes.of(view => ({ class: isActive(view) ? 'paraflow-headings-active' : '' })),
		Prec.highest(keymap.of(['Enter', 'Shift-Enter', 'Backspace'].map(key => ({ key, run: (view: EditorView) => {
			if (!isActive(view) || view.composing || requireCompositionState(view.state) || classifyCurrentSelectionMode(view.state) !== 'caret') return false;
			const plan = key === 'Backspace' ? planHeadingBackspace(view.state) : planHeadingEnter(view.state, key === 'Enter' ? 'enter' : 'shift-enter');
			if (!plan) return false;
			dispatchParagraphEditPlan(view, plan, plan.operation);
			return true;
		} })))),
		EditorState.transactionFilter.of(transaction => {
			if (!isStateActive(transaction.startState) || !transaction.selection || transaction.docChanged ||
				requireCompositionState(transaction.startState) || transaction.state.field(compositionStateField, false) ||
				excludedSelectionModeForTransaction(transaction) !== null ||
				!recognizedNormalSelectionTransaction(transaction) || transaction.newSelection.ranges.length !== 1) return transaction;
			const range = transaction.newSelection.main;
			if (!range.empty && range.from === 0 && range.to === transaction.state.doc.length) return transaction;
			const previous = transaction.startState.selection.main;
			const bias = range.head < previous.head ? -1 : 1;
			const leavingStart = range.empty && previous.empty && !transaction.isUserEvent('select.pointer') && bias < 0 &&
				getHeadingProjectionState(transaction.startState)?.headings.some(heading => heading.contentFrom === previous.head);
			const head = normalizeHeadingSelectionEndpoint(transaction.state, range.head, bias, leavingStart);
			const anchor = range.empty ? head : normalizeHeadingSelectionEndpoint(transaction.state, range.anchor, range.anchor < range.head ? 1 : -1);
			if (head === range.head && anchor === range.anchor) return transaction;
			return [transaction, { selection: EditorSelection.create([range.empty ? EditorSelection.cursor(head, bias)
				: EditorSelection.range(anchor, head, range.goalColumn, range.bidiLevel ?? undefined)]), sequential: true }];
		})];
}
