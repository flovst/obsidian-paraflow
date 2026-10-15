import {
	Annotation,
	EditorSelection,
	type EditorState,
	type TransactionSpec,
	Transaction,
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { selectionModeAnnotation } from '../runtime/input-state.js';
import { codeMarkersActive } from '../code-blocks/editable-boundaries.js';
import { discoverCodeBlocks } from '../code-blocks/model.js';

export type ParagraphOperationId =
	| 'enter'
	| 'shift-enter'
	| 'backspace-gap'
	| 'delete-gap'
	| 'backspace-heading-prefix';

export interface ParagraphEditPlan {
	readonly isolateHistory?: boolean;
	readonly operation: ParagraphOperationId;
	readonly change: { readonly from: number; readonly to: number; readonly insert: string };
	readonly selection: EditorSelection;
	readonly ownedRange: { readonly from: number; readonly to: number };
}

export const paragraphEditAnnotation = Annotation.define<ParagraphOperationId>();
export type ParagraphNavigationOperationId = 'left' | 'right' | 'home' | 'end' | 'up' | 'down';
export const paragraphNavigationAnnotation = Annotation.define<ParagraphNavigationOperationId>();

function assertIntegerPosition(position: number, maximum: number, label: string): void {
	if (!Number.isInteger(position) || position < 0 || position > maximum) {
		throw new RangeError(`${label} is outside the document`);
	}
}

export function validateParagraphEditPlan(
	documentLength: number,
	plan: ParagraphEditPlan,
	expectedOperation: ParagraphOperationId,
): void {
	if (plan.operation !== expectedOperation) {
		throw new Error('Paragraph edit plan operation does not match the expected operation');
	}
	assertIntegerPosition(plan.change.from, documentLength, 'Paragraph change start');
	assertIntegerPosition(plan.change.to, documentLength, 'Paragraph change end');
	if (plan.change.from > plan.change.to) throw new RangeError('Paragraph change is not ordered');
	assertIntegerPosition(plan.ownedRange.from, documentLength, 'Paragraph owned range start');
	assertIntegerPosition(plan.ownedRange.to, documentLength, 'Paragraph owned range end');
	if (plan.ownedRange.from > plan.ownedRange.to) {
		throw new RangeError('Paragraph owned range is not ordered');
	}
	if (
		plan.change.from < plan.ownedRange.from ||
		plan.change.to > plan.ownedRange.to
	) {
		throw new Error('Paragraph change is outside its owned range');
	}
	if (plan.selection.ranges.length !== 1 || !plan.selection.main.empty) {
		throw new Error('Paragraph edit result selection must be one collapsed caret');
	}
	const resultLength = documentLength - (plan.change.to - plan.change.from) + plan.change.insert.length;
	assertIntegerPosition(plan.selection.main.head, resultLength, 'Paragraph result selection');
}

function transactionFor(plan: ParagraphEditPlan): TransactionSpec {
	const userEvent = plan.operation === 'backspace-gap' ||
		plan.operation === 'backspace-heading-prefix'
		? 'delete.backward'
		: plan.operation === 'delete-gap' ? 'delete.forward' : 'input';
	return {
		annotations: [
			...(plan.isolateHistory || plan.operation === 'enter' || plan.operation === 'shift-enter'
				? [isolateHistory.of('full')] : []),
			selectionModeAnnotation.of('normal'),
			paragraphEditAnnotation.of(plan.operation),
			Transaction.userEvent.of(userEvent),
		],
		changes: plan.change,
		scrollIntoView: true,
		selection: plan.selection,
	};
}

export function dispatchParagraphSelection(
	view: EditorView,
	operation: ParagraphNavigationOperationId,
	selection: EditorSelection,
): void {
	view.dispatch({
		annotations: [
			selectionModeAnnotation.of('normal'),
			paragraphNavigationAnnotation.of(operation),
			Transaction.userEvent.of(operation === 'left' || operation === 'right'
				? 'move.character'
				: 'move.line'),
		],
		scrollIntoView: true,
		selection,
	});
}

export function dispatchParagraphEditPlan(
	view: EditorView,
	plan: ParagraphEditPlan,
	expectedOperation: ParagraphOperationId,
): void {
	plan = adaptParagraphBlockGap(view.state, plan, view.state.facet(codeMarkersActive));
	validateParagraphEditPlan(view.state.doc.length, plan, expectedOperation);
	view.dispatch(transactionFor(plan));
}

/** Container projections use the same block boundary rule before mapping to source. */
export function adaptParagraphBlockGap(state: EditorState, plan: ParagraphEditPlan, codeActive: boolean): ParagraphEditPlan {
	if(plan.operation==='backspace-gap'){
		const block=discoverCodeBlocks(state).find(block=>block.closed&&!block.indented&&block.lines.length&&block.to===plan.change.from);
		if(block){
			plan={...plan,change:{...plan.change,insert:'\n'},selection:EditorSelection.create([EditorSelection.cursor(codeActive?block.lines.at(-1)!.to:block.to)])};
		}
	}
	return plan;
}
