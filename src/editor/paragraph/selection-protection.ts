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
	selectionHeadMovementBias,
	selectionModeAnnotation,
} from '../runtime/input-state.js';
import type { ParagraphRangeIndex } from './projection.js';
import {
	getParagraphProjectionState,
	requireParagraphProjectionState,
} from './projection.js';
import {
	normalizeStructuredListCaretEndpoint,
	normalizeStructuredListSelectionEndpoint,
} from '../structured-list/selection-protection.js';
import { getStructuredListSelectionTransparentRanges } from '../structured-list/projection.js';
import { normalizeHeadingSelectionEndpoint } from './heading-projection.js';
import { editableEndpoint, codeMarkersActive } from '../code-blocks/editable-boundaries.js';
import { discoverCodeBlocks } from '../code-blocks/model.js';
import { creationHistory } from '../runtime/creation-history.js';
import {isVirtualTailActive} from '../runtime/virtual-tail.js';
import {discoverMath} from '../math/syntax.js';
import {clampMathBody, projectMathSource} from '../math/source.js';

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
	if (!range.empty) return range.anchor < range.head ? 1 : -1;
	const movement = event === 'move.character' || event === 'move.line' || event === 'select' ||
		(!transaction.docChanged && !transaction.isUserEvent('select.pointer') &&
			transaction.annotation(selectionModeAnnotation) === 'normal');
	if (movement && range.head !== transaction.startState.selection.main.head) {
		return range.head < transaction.startState.selection.main.head ? -1 : 1;
	}
	return range.assoc < 0 ? -1 : 1;
}

function recognizedParagraphSelectionTransaction(transaction: Transaction): boolean {
	const event = transaction.annotation(Transaction.userEvent);
	return recognizedNormalSelectionTransaction(transaction) ||
		event === 'move.character' || event === 'move.line';
}

function pointerEndpoint(
	position: number,
	index: ParagraphRangeIndex,
	listGaps: readonly { readonly from: number; readonly to: number }[],
): {
	readonly assoc: -1 | 1;
	readonly position: number;
} {
	const leadingGap = position === 0 && !index.editableAnchors.includes(0)
		? index.gaps.find((gap) => gap.from === 0)
		: undefined;
	if (leadingGap) return { assoc: 1, position: leadingGap.to };
	const gap = index.containingGap(position) ?? listGaps.find((candidate) =>
		candidate.from < position && position < candidate.to);
	if (!gap) return { assoc: 1, position };
	const leftDistance = position - gap.from;
	const rightDistance = gap.to - position;
	return leftDistance < rightDistance
		? { assoc: -1, position: gap.from }
		: { assoc: 1, position: gap.to };
}

function normalizedGapEndpoint(
	position: number,
	bias: -1 | 1,
	index: ParagraphRangeIndex,
	listGaps: readonly { readonly from: number; readonly to: number }[],
): number {
	const paragraphPosition = index.normalize(position, bias);
	if (paragraphPosition !== position) return paragraphPosition;
	const gap = listGaps.find((candidate) =>
		candidate.from < position && position < candidate.to);
	if (!gap) return position;
	return bias < 0 ? gap.from : gap.to;
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
	endpoint: 'cursor' | 'range',
	leaveHeadingPrefix = false,
): { readonly assoc: -1 | 1; readonly position: number } {
	const codePosition=endpoint==='cursor'&&state.facet(codeMarkersActive)
		? editableEndpoint(state,discoverCodeBlocks(state),position,bias,EditorSelection.cursor(position)) : position;
	const headingPosition = normalizeHeadingSelectionEndpoint(state, codePosition, bias,leaveHeadingPrefix);
	const gapPosition=getParagraphProjectionState(state)?.rangeIndex.normalize(headingPosition,bias)??headingPosition;
	const bodyPosition=endpoint==='cursor'&&state.facet(codeMarkersActive)
		? editableEndpoint(state,discoverCodeBlocks(state),gapPosition,bias,EditorSelection.cursor(gapPosition)):gapPosition;
	const math = endpoint === 'cursor' ? discoverMath(state).find(item =>
		item.display && item.from <= bodyPosition && bodyPosition <= item.to) : null;
	const mathPosition = math ? clampMathBody(projectMathSource(state, math), bodyPosition) : bodyPosition;
	const normalizeListEndpoint = endpoint === 'cursor'
		? normalizeStructuredListCaretEndpoint
		: normalizeStructuredListSelectionEndpoint;
	const listPosition = normalizeListEndpoint(
		state,
		mathPosition,
		bias,
	);
	return {
		assoc: headingPosition !== position || listPosition > headingPosition ? 1 : bias,
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

/** Resolve an owner-proven block exit through the same gap and hidden-prefix policy. */
export function normalizeParagraphSelectionEndpoint(
	state: EditorState,
	position: number,
	bias: -1 | 1,
	endpoint: 'cursor' | 'range' = 'cursor',
): number {
	const projection = getParagraphProjectionState(state);
	if (!projection) return position;
	const mapped = normalizedGapEndpoint(position, bias, projection.rangeIndex,
		getStructuredListSelectionTransparentRanges(state));
	return normalizeBlockEndpoint(state, mapped, bias, endpoint).position;
}

function normalizedSelection(transaction: Transaction): EditorSelection | null {
	const projection = getParagraphProjectionState(transaction.state);
	if (!projection) return null;
	const index = projection.rangeIndex;
	const listGaps = getStructuredListSelectionTransparentRanges(transaction.state);
	const range = transaction.newSelection.main;
	const pointer = transaction.isUserEvent('select.pointer');
	const leaveHeadingPrefix=!pointer&&!transaction.docChanged&&range.head<transaction.startState.selection.main.head&&
		(transaction.isUserEvent('select')||transaction.isUserEvent('move.character'));
	if (range.empty) {
		const gap = index.containingGap(range.head) ?? listGaps.find((candidate) =>
			candidate.from < range.head && range.head < candidate.to);
		const directBlock = normalizeBlockEndpoint(
			transaction.state,
			range.head,
			endpointBias(transaction, range),
			'cursor',
			leaveHeadingPrefix,
		);
		const onLeadingGapHead = pointer && range.head === 0 && !index.editableAnchors.includes(0) &&
			index.gaps.some((candidate) => candidate.from === 0);
		if (!gap && !onLeadingGapHead && directBlock.position === range.head) return null;
		const bias = endpointBias(transaction, range);
		const mapped = pointer
			? pointerEndpoint(range.head, index, listGaps)
			: {
				assoc: bias,
				position: index.normalize(range.head, bias),
			};
		const block = normalizeBlockEndpoint(
			transaction.state,
			mapped.position,
			mapped.assoc,
			'cursor',
			leaveHeadingPrefix,
		);
		return cursorSelection(range, block.position, block.assoc);
	}
	const direction = range.anchor < range.head ? 1 : -1;
	const headBias = direction === 1 ? -1 : 1;
	const gapBias = selectionHeadMovementBias(transaction) ?? headBias;
	const headPosition = normalizedGapEndpoint(range.head, gapBias, index, listGaps);
	const anchor = normalizeBlockEndpoint(
		transaction.state,
		normalizedGapEndpoint(range.anchor, direction, index, listGaps),
		direction,
		'range',
	);
	const head = normalizeBlockEndpoint(
		transaction.state,
		headPosition,
		headPosition === range.head ? headBias : gapBias,
		'range',
	);
	if (anchor.position === range.anchor && head.position === range.head) return null;
	return rangeSelection(range, anchor.position, head.position);
}

function filterSelection(
	transaction: Transaction,
	options: ParagraphSelectionProtectionOptions,
) {
	if(isVirtualTailActive(transaction.state))return transaction;
	// The code owner already maps both Enter-body and true-departure targets through its insertion.
	if (transaction.docChanged && !transaction.isUserEvent('undo') && !transaction.isUserEvent('redo') &&
		transaction.effects.some(effect => effect.is(creationHistory) && effect.value.owner === 'code' && effect.value.created)) return transaction;
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
