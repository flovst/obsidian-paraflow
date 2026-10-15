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
	selectionHeadMovementBias,
	selectionModeAnnotation,
} from '../runtime/input-state.js';
import type { SourceRange, StructuredListRangeIndex } from './model.js';
import { paragraphNavigationAnnotation } from '../paragraph/edit-plan.js';
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
	gapBias: -1 | 1 = bias,
): number {
	const transparentRange = transparentRanges.find((range) =>
		range.from < position && position < range.to);
	if (transparentRange) bias = gapBias;
	const gapPosition = transparentRange
		? bias < 0 ? transparentRange.from : transparentRange.to
		: position;
	const startBoundary = bias === 1
		? rangeIndex.protectedRanges.find((range) => range.from === gapPosition)
		: null;
	if (startBoundary) return startBoundary.to;
	return rangeIndex.mapEndpoint(gapPosition, bias);
}

function mappedCaretEndpoint(
	rangeIndex: StructuredListRangeIndex,
	transparentRanges: readonly SourceRange[],
	position: number,
	bias: -1 | 1,
): number {
	const gap = transparentRanges.find((range) => range.from < position && position < range.to);
	const gapPosition = gap ? bias < 0 ? gap.from : gap.to : position;
	const prefix = rangeIndex.protectedRanges.find((range) =>
		range.from <= gapPosition && gapPosition < range.to);
	return prefix?.to ?? gapPosition;
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

export function normalizeStructuredListCaretEndpoint(
	state: EditorState,
	position: number,
	bias: -1 | 1,
): number {
	const rangeIndex = getStructuredListProjectionState(state)?.rangeIndex;
	return rangeIndex
		? mappedCaretEndpoint(
			rangeIndex,
			getStructuredListSelectionTransparentRanges(state),
			position,
			bias,
		)
		: position;
}

function caretBias(transaction: Transaction, range: SelectionRange): -1 | 1 {
	if (!transaction.docChanged && transaction.annotation(selectionModeAnnotation) === 'normal' &&
		range.head !== transaction.startState.selection.main.head) {
		return range.head < transaction.startState.selection.main.head ? -1 : 1;
	}
	return range.assoc < 0 ? -1 : 1;
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

function mappedCursorSelection(
	transaction: Transaction,
	range: SelectionRange,
	rangeIndex: StructuredListRangeIndex,
	transparentRanges: readonly SourceRange[],
): EditorSelection {
	const pointer = transaction.isUserEvent('select.pointer')
		? pointerEndpoint(range.head, transparentRanges)
		: null;
	const bias = pointer?.assoc ?? caretBias(transaction, range);
	const requested = pointer?.position ?? range.head;
	const position = mappedCaretEndpoint(rangeIndex, transparentRanges, requested, bias);
	const visibleStart = rangeIndex.protectedRanges.some((prefix) => prefix.to === position);
	const assoc = visibleStart ? 1 : position === range.head ? range.assoc : bias;
	return preservedCursorSelection(range, position, assoc);
}

function crossedPrefixHead(transaction: Transaction, index: StructuredListRangeIndex, head: number): number | null {
	if (selectionHeadMovementBias(transaction) !== -1 || transaction.annotation(paragraphNavigationAnnotation) === 'home') return null;
	const prefix = index.protectedRanges.find(prefix =>
		transaction.startState.selection.main.head === prefix.to && prefix.from <= head && head < prefix.to);
	if (!prefix) return null;
	return prefix.from === 0 ? prefix.to : transaction.state.doc.lineAt(prefix.from).from - 1;
}

function mappedSelection(transaction: Transaction): EditorSelection | null {
	const projection = getStructuredListProjectionState(transaction.state);
	if (!projection) return null;
	const rangeIndex = projection.rangeIndex;
	const transparentRanges = getStructuredListSelectionTransparentRanges(transaction.state);
	const range = transaction.newSelection.main;
	const { anchor, head } = range;
	if (anchor === head) {
		return mappedCursorSelection(transaction, range, rangeIndex, transparentRanges);
	}
	const sharedBoundary = sharedProtectedBoundary(rangeIndex, anchor, head);
	if (sharedBoundary !== null) {
		return preservedCursorSelection(range, sharedBoundary);
	}
	const direction = anchor < head ? 1 : -1;
	const mappedHead = mappedRangeHead(transaction, rangeIndex, transparentRanges, head, direction);
	return preservedRangeSelection(
		range,
		mappedEndpoint(rangeIndex, transparentRanges, anchor, direction),
		mappedHead,
	);
}

function mappedRangeHead(transaction: Transaction, index: StructuredListRangeIndex, transparent: readonly SourceRange[], head: number, direction: -1 | 1): number {
	const bias = direction === 1 ? -1 : 1;
	return crossedPrefixHead(transaction, index, head) ?? mappedEndpoint(index, transparent, head, bias,
		selectionHeadMovementBias(transaction) ?? bias);
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
