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
import type { SourceRange, StructuredListRangeIndex } from './model.js';
import {
	getStructuredListProjectionState,
	getStructuredListSelectionTransparentRanges,
} from './projection.js';

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
	transparentRanges: readonly SourceRange[],
	position: number,
	bias: -1 | 1,
): number {
	const startBoundary = rangeIndex.protectedRanges.find((range) => range.from === position);
	if (startBoundary) return startBoundary.to;
	const prefixPosition = rangeIndex.mapEndpoint(position, bias);
	if (prefixPosition !== position) return prefixPosition;
	const transparentRange = transparentRanges.find((range) =>
		range.from < position && position < range.to);
	if (!transparentRange) return position;
	return bias < 0 ? transparentRange.from : transparentRange.to;
}

function pointerEndpoint(
	position: number,
	transparentRanges: readonly SourceRange[],
): { readonly assoc: -1 | 1; readonly position: number } | null {
	const range = transparentRanges.find((candidate) =>
		candidate.from < position && position < candidate.to);
	if (!range) return null;
	const leftDistance = position - range.from;
	const rightDistance = range.to - position;
	return leftDistance < rightDistance
		? { assoc: -1, position: range.from }
		: { assoc: 1, position: range.to };
}

export function normalizeStructuredListSelectionEndpoint(
	state: EditorState,
	position: number,
	bias: -1 | 1,
): number {
	const rangeIndex = getStructuredListProjectionState(state)?.rangeIndex;
	return rangeIndex
		? mappedEndpoint(
			rangeIndex,
			getStructuredListSelectionTransparentRanges(state),
			position,
			bias,
		)
		: position;
}

function preservedCursorSelection(
	range: SelectionRange,
	position: number,
	assoc: number = range.assoc,
): EditorSelection {
	return EditorSelection.create([EditorSelection.cursor(
		position,
		assoc,
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
	const projection = getStructuredListProjectionState(transaction.state);
	if (!projection) return null;
	const rangeIndex = projection.rangeIndex;
	const transparentRanges = getStructuredListSelectionTransparentRanges(transaction.state);
	const range = transaction.newSelection.main;
	const { anchor, head } = range;
	if (anchor === head) {
		const pointer = transaction.isUserEvent('select.pointer')
			? pointerEndpoint(anchor, transparentRanges)
			: null;
		return pointer
			? preservedCursorSelection(range, pointer.position, pointer.assoc)
			: preservedCursorSelection(
				range,
				mappedEndpoint(rangeIndex, transparentRanges, anchor, 1),
			);
	}
	const sharedBoundary = sharedProtectedBoundary(rangeIndex, anchor, head);
	if (sharedBoundary !== null) {
		return preservedCursorSelection(range, sharedBoundary);
	}
	const direction = anchor < head ? 1 : -1;
	return preservedRangeSelection(
		range,
		mappedEndpoint(rangeIndex, transparentRanges, anchor, direction),
		mappedEndpoint(rangeIndex, transparentRanges, head, direction === 1 ? -1 : 1),
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
