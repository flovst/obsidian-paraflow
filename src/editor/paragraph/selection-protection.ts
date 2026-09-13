import {
	EditorSelection,
	EditorState,
	Transaction,
	type Extension,
	type SelectionRange,
} from '@codemirror/state';
import {
	compositionStateField,
	excludedSelectionModeForTransaction,
	recognizedNormalSelectionTransaction,
	requireCompositionState,
} from '../runtime/input-state.js';
import type { ParagraphRangeIndex } from './projection.js';
import {
	getParagraphProjectionState,
	requireParagraphProjectionState,
} from './projection.js';
import { normalizeStructuredListSelectionEndpoint } from '../structured-list/selection-protection.js';
import { normalizeHeadingSelectionEndpoint } from './heading-projection.js';

export interface ParagraphSelectionProtectionOptions {
	readonly isLivePreview: (state: EditorState) => boolean;
	readonly isSurfaceState?: (state: EditorState) => boolean;
}

function exactWholeDocument(state: EditorState): boolean {
	const selection = state.selection;
	return selection.ranges.length === 1 && !selection.main.empty &&
		selection.main.from === 0 && selection.main.to === state.doc.length;
}

function resultCompositionActive(transaction: Transaction): boolean {
	const runtime = transaction.state.field(
		// The result state may intentionally remove the runtime in the same reconfiguration.
		compositionStateField,
		false,
	);
	return runtime ?? false;
}

function endpointBias(transaction: Transaction, range: SelectionRange): -1 | 1 {
	const event = transaction.annotation(Transaction.userEvent);
	if (event === 'move.character' || event === 'move.line') {
		return range.head < transaction.startState.selection.main.head ? -1 : 1;
	}
	if (!range.empty) return range.anchor < range.head ? 1 : -1;
	return range.assoc < 0 ? -1 : 1;
}

function recognizedParagraphSelectionTransaction(transaction: Transaction): boolean {
	const event = transaction.annotation(Transaction.userEvent);
	return recognizedNormalSelectionTransaction(transaction) ||
		event === 'move.character' || event === 'move.line';
}

function pointerEndpoint(position: number, index: ParagraphRangeIndex): {
	readonly assoc: -1 | 1;
	readonly position: number;
} {
	const leadingGap = position === 0
		? index.gaps.find((gap) => gap.from === 0)
		: undefined;
	if (leadingGap) return { assoc: 1, position: leadingGap.to };
	const gap = index.containingGap(position);
	if (!gap) return { assoc: 1, position };
	const leftDistance = position - gap.from;
	const rightDistance = gap.to - position;
	return leftDistance < rightDistance
		? { assoc: -1, position: gap.from }
		: { assoc: 1, position: gap.to };
}

function cursorSelection(
	range: SelectionRange,
	position: number,
	assoc: -1 | 1,
): EditorSelection {
	return EditorSelection.create([EditorSelection.cursor(
		position,
		assoc,
		range.bidiLevel ?? undefined,
		range.goalColumn,
	)]);
}

function normalizeBlockEndpoint(
	state: EditorState,
	position: number,
	bias: -1 | 1,
): { readonly assoc: -1 | 1; readonly position: number } {
	const headingPosition = normalizeHeadingSelectionEndpoint(state, position, bias);
	const listPosition = normalizeStructuredListSelectionEndpoint(
		state,
		headingPosition,
		bias,
	);
	return {
		assoc: headingPosition !== position || listPosition !== headingPosition ? 1 : bias,
		position: listPosition,
	};
}

function rangeSelection(
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

function normalizedSelection(transaction: Transaction): EditorSelection | null {
	const projection = getParagraphProjectionState(transaction.state);
	if (!projection) return null;
	if (!projection.authority.complete) return null;
	const index = projection.rangeIndex;
	const range = transaction.newSelection.main;
	const pointer = transaction.isUserEvent('select.pointer');
	if (range.empty) {
		const gap = index.containingGap(range.head);
		const directBlock = normalizeBlockEndpoint(
			transaction.state,
			range.head,
			endpointBias(transaction, range),
		);
		const onLeadingGapHead = pointer && range.head === 0 &&
			index.gaps.some((candidate) => candidate.from === 0);
		if (!gap && !onLeadingGapHead && directBlock.position === range.head) return null;
		const bias = endpointBias(transaction, range);
		const mapped = pointer
			? pointerEndpoint(range.head, index)
			: {
				assoc: bias,
				position: index.normalize(range.head, bias),
			};
		const block = normalizeBlockEndpoint(
			transaction.state,
			mapped.position,
			mapped.assoc,
		);
		return cursorSelection(range, block.position, block.assoc);
	}
	const direction = range.anchor < range.head ? 1 : -1;
	const headBias = direction === 1 ? -1 : 1;
	const anchor = normalizeBlockEndpoint(
		transaction.state,
		index.normalize(range.anchor, direction),
		direction,
	);
	const head = normalizeBlockEndpoint(
		transaction.state,
		index.normalize(range.head, headBias),
		headBias,
	);
	if (anchor.position === range.anchor && head.position === range.head) return null;
	return rangeSelection(range, anchor.position, head.position);
}

function filterSelection(
	transaction: Transaction,
	options: ParagraphSelectionProtectionOptions,
) {
	if (!options.isLivePreview(transaction.startState) ||
		!options.isLivePreview(transaction.state)) return transaction;
	if (options.isSurfaceState && !options.isSurfaceState(transaction.startState)) {
		return transaction;
	}
	if (requireCompositionState(transaction.startState) || resultCompositionActive(transaction)) {
		return transaction;
	}
	if (transaction.newSelection.ranges.length !== 1 || exactWholeDocument(transaction.state)) {
		return transaction;
	}
	if (excludedSelectionModeForTransaction(transaction) !== null) return transaction;
	if (!recognizedParagraphSelectionTransaction(transaction)) return transaction;
	requireParagraphProjectionState(transaction.startState);
	const selection = normalizedSelection(transaction);
	return selection ? [transaction, { selection, sequential: true }] : transaction;
}

export function createParagraphSelectionProtection(
	options: ParagraphSelectionProtectionOptions,
): Extension {
	return EditorState.transactionFilter.of((transaction) => filterSelection(transaction, options));
}
