import {
	EditorSelection,
	EditorState,
	type Extension,
	type SelectionRange,
	Transaction,
} from '@codemirror/state';
import {
	compositionStateField,
	excludedSelectionModeForTransaction,
	recognizedNormalSelectionTransaction,
} from '../runtime/input-state.js';
import type { StructuredListRangeIndex } from './model.js';
import { getStructuredListProjectionState } from './projection.js';

function exactWholeDocument(state: EditorState): boolean {
	const selection = state.selection;
	return selection.ranges.length === 1 &&
		!selection.main.empty &&
		selection.main.from === 0 &&
		selection.main.to === state.doc.length;
}

function sharedProtectedBoundary(
	rangeIndex: StructuredListRangeIndex,
	anchor: number,
	head: number,
): number | null {
	const anchorRange = rangeIndex.containing(anchor);
	const headRange = rangeIndex.containing(head);
	return anchorRange && headRange &&
		anchorRange.from === headRange.from && anchorRange.to === headRange.to
		? anchorRange.to
		: null;
}

function mappedEndpoint(
	rangeIndex: StructuredListRangeIndex,
	position: number,
	bias: -1 | 1,
): number {
	const startBoundary = bias === 1
		? rangeIndex.protectedRanges.find((range) => range.from === position)
		: null;
	return startBoundary?.to ?? rangeIndex.mapEndpoint(position, bias);
}

export function normalizeStructuredListSelectionEndpoint(
	state: EditorState,
	position: number,
	bias: -1 | 1,
): number {
	const rangeIndex = getStructuredListProjectionState(state)?.rangeIndex;
	return rangeIndex ? mappedEndpoint(rangeIndex, position, bias) : position;
}

function preservedCursorSelection(range: SelectionRange, position: number): EditorSelection {
	return EditorSelection.create([EditorSelection.cursor(
		position,
		range.assoc,
		range.bidiLevel ?? undefined,
		range.goalColumn,
	)]);
}

function preservedRangeSelection(
	range: SelectionRange,
	anchor: number,
	head: number,
): EditorSelection {
	return EditorSelection.create([EditorSelection.range(
		anchor,
		head,
		range.goalColumn,
		range.bidiLevel ?? undefined,
	)]);
}

function mappedSelection(transaction: Transaction): EditorSelection | null {
	const rangeIndex = getStructuredListProjectionState(transaction.state)?.rangeIndex;
	if (!rangeIndex) return null;
	const range = transaction.newSelection.main;
	const { anchor, head } = range;
	if (anchor === head) {
		return preservedCursorSelection(range, mappedEndpoint(rangeIndex, anchor, 1));
	}
	const sharedBoundary = sharedProtectedBoundary(rangeIndex, anchor, head);
	if (sharedBoundary !== null) {
		return preservedCursorSelection(range, sharedBoundary);
	}
	const direction = anchor < head ? 1 : -1;
	return preservedRangeSelection(
		range,
		mappedEndpoint(rangeIndex, anchor, direction),
		mappedEndpoint(rangeIndex, head, direction === 1 ? -1 : 1),
	);
}

function compositionActive(transaction: Transaction): boolean {
	return transaction.startState.field(compositionStateField) ||
		(transaction.state.field(compositionStateField, false) ?? false);
}

function geometryExcluded(transaction: Transaction): boolean {
	return transaction.newSelection.ranges.length !== 1 ||
		(exactWholeDocument(transaction.state) && !transaction.isUserEvent('select.pointer'));
}

function selectionModeExcluded(transaction: Transaction): boolean {
	return excludedSelectionModeForTransaction(transaction) !== null;
}

function selectionFilter(
	transaction: Transaction,
	isLivePreview: (state: EditorState) => boolean,
) {
	if (!isLivePreview(transaction.startState)) return transaction;
	if (compositionActive(transaction) || geometryExcluded(transaction)) return transaction;
	if (selectionModeExcluded(transaction)) return transaction;
	if (!recognizedNormalSelectionTransaction(transaction)) return transaction;
	const selection = mappedSelection(transaction);
	return selection ? [transaction, { selection, sequential: true }] : transaction;
}

export interface SelectionProtectionOptions {
	readonly isLivePreview: (state: EditorState) => boolean;
}

export function createSelectionProtection(options: SelectionProtectionOptions): Extension {
	return EditorState.transactionFilter.of((transaction) =>
		selectionFilter(transaction, options.isLivePreview));
}
