import { EditorSelection, findClusterBreak, type EditorState } from '@codemirror/state';
import type { VisualNavigationAdapter } from '../runtime/navigation-core.js';
import type { ParagraphEditPlan } from './edit-plan.js';
import { requireParagraphProjectionState } from './projection.js';
import { ordinaryParagraphAtCaret } from './syntax.js';
import {
	headingAtCaret,
	normalizeHeadingSelectionEndpoint,
} from './heading-projection.js';
import { verticalEntryRange } from './syntax.js';
import { normalizeStructuredListSelectionEndpoint } from '../structured-list/selection-protection.js';
import { capabilitiesForTopLevelBlock } from './model.js';
import type { ParagraphAuthority, TopLevelBlockBoundary } from './model.js';

export type ParagraphEnterOperation = 'enter' | 'shift-enter';
export type ParagraphDeletionOperation = 'backspace' | 'delete';

function normalizeBlockEndpoint(
	state: EditorState,
	position: number,
	bias: -1 | 1,
): number {
	return normalizeStructuredListSelectionEndpoint(
		state,
		normalizeHeadingSelectionEndpoint(state, position, bias),
		bias,
	);
}

function crossesCompleteGap(
	state: ReturnType<typeof requireParagraphProjectionState>,
	from: number,
	to: number,
): boolean {
	const lower = Math.min(from, to);
	const upper = Math.max(from, to);
	return state.rangeIndex.gaps.some((gap) => lower <= gap.from && gap.to <= upper);
}

function blockAtPosition(
	authority: ParagraphAuthority,
	position: number,
): TopLevelBlockBoundary | null {
	return authority.blocks.find((block) =>
		block.from <= position && position <= block.to) ?? null;
}

function blockAcrossGap(
	authority: ParagraphAuthority,
	gap: { readonly from: number; readonly to: number },
	forward: boolean,
): TopLevelBlockBoundary | null {
	return authority.blocks.find((block) => forward
		? block.from === gap.to
		: block.to === gap.from) ?? null;
}

export function planParagraphEnter(
	state: EditorState,
	operation: ParagraphEnterOperation,
): ParagraphEditPlan | null {
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
	const projection = requireParagraphProjectionState(state);
	if (!projection.authority.complete) return null;
	const position = state.selection.main.head;
	const paragraph = ordinaryParagraphAtCaret(
		state,
		position,
		projection.authority.paragraphs,
	);
	const editableAnchor = projection.rangeIndex.editableAnchors.includes(position);
	if (!paragraph && !editableAnchor) return null;
	const atEditableAnchor = !paragraph && editableAnchor;
	const insert = operation === 'enter' ? '\n\n' : '\n';
	const selectionPosition = operation === 'enter'
		? position + 2
		: atEditableAnchor ? position : position + 1;
	return Object.freeze({
		change: Object.freeze({ from: position, insert, to: position }),
		operation,
		ownedRange: Object.freeze(paragraph ?? { from: position, to: position }),
		selection: EditorSelection.create([EditorSelection.cursor(selectionPosition, 1)]),
	});
}

export function planGapDeletion(
	state: EditorState,
	operation: ParagraphDeletionOperation,
): ParagraphEditPlan | null {
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
	const projection = requireParagraphProjectionState(state);
	if (!projection.authority.complete) return null;
	const position = state.selection.main.head;
	const gap = projection.rangeIndex.gaps.find((candidate) =>
		operation === 'backspace' ? candidate.to === position : candidate.from === position);
	if (!gap) return null;
	return Object.freeze({
		change: Object.freeze({ from: gap.from, insert: '', to: gap.to }),
		operation: operation === 'backspace' ? 'backspace-gap' : 'delete-gap',
		ownedRange: gap,
		selection: EditorSelection.create([EditorSelection.cursor(gap.from, 1)]),
	});
}

export function planHeadingBackspace(state: EditorState): ParagraphEditPlan | null {
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
	const heading = headingAtCaret(state, state.selection.main.head);
	if (!heading || state.selection.main.head !== heading.contentFrom) return null;
	return Object.freeze({
		change: Object.freeze({ from: heading.prefixFrom, insert: '', to: heading.prefixTo }),
		operation: 'backspace-heading-prefix',
		ownedRange: Object.freeze({ from: heading.from, to: heading.to }),
		selection: EditorSelection.create([EditorSelection.cursor(heading.prefixFrom, 1)]),
	});
}

export function resolveHorizontalSelection(
	state: EditorState,
	forward: boolean,
	visual: VisualNavigationAdapter,
): EditorSelection | null {
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
	const projection = requireParagraphProjectionState(state);
	if (!projection.authority.complete) return null;
	const current = state.selection.main;
	const bias = forward ? 1 : -1;
	const ownsCurrent = projection.rangeIndex.containingGap(current.head) !== null ||
		projection.rangeIndex.editableAnchors.includes(current.head) ||
		ordinaryParagraphAtCaret(state, current.head, projection.authority.paragraphs) !== null;
	if (!ownsCurrent) return null;
	const candidate = visual.moveByChar({
		assoc: current.assoc,
		position: current.head,
	}, forward);
	if (!projection.rangeIndex.containingGap(current.head) &&
		!projection.rangeIndex.editableAnchors.includes(current.head) &&
		!projection.rangeIndex.containingGap(candidate.position) &&
		!crossesCompleteGap(projection, current.head, candidate.position)) return null;
	const position = normalizeBlockEndpoint(
		state,
		projection.rangeIndex.normalize(candidate.position, bias),
		bias,
	);
	const selection = EditorSelection.create([EditorSelection.cursor(position, bias)]);
	return selection.eq(state.selection, true) ? null : selection;
}

export function resolveLineBoundarySelection(
	state: EditorState,
	toEnd: boolean,
	visual: VisualNavigationAdapter,
): EditorSelection | null {
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
	const projection = requireParagraphProjectionState(state);
	if (!projection.authority.complete) return null;
	const current = state.selection.main;
	const bias = toEnd ? 1 : -1;
	const ownsCurrent = projection.rangeIndex.containingGap(current.head) !== null ||
		projection.rangeIndex.editableAnchors.includes(current.head) ||
		ordinaryParagraphAtCaret(state, current.head, projection.authority.paragraphs) !== null;
	if (!ownsCurrent) return null;
	const start = { assoc: current.assoc, position: current.head };
	const candidate = toEnd ? visual.visualLineEnd(start) : visual.visualLineStart(start);
	if (!projection.rangeIndex.containingGap(candidate.position)) return null;
	const position = projection.rangeIndex.normalize(candidate.position, bias);
	const selection = EditorSelection.create([EditorSelection.cursor(position, bias)]);
	return selection.eq(state.selection, true) ? null : selection;
}

export function resolveVerticalStart(state: EditorState): {
	readonly assoc: -1 | 0 | 1;
	readonly position: number;
} | null {
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
	const projection = requireParagraphProjectionState(state);
	if (!projection.authority.complete) return null;
	const current = state.selection.main;
	const indexedCurrent = projection.rangeIndex.containingGap(current.head) !== null ||
		projection.rangeIndex.editableAnchors.includes(current.head);
	const block = indexedCurrent
		? null
		: blockAtPosition(projection.authority, current.head);
	if (!indexedCurrent && (!block ||
		capabilitiesForTopLevelBlock(block.kind).verticalNavigation === 'host')) return null;
	return { assoc: current.assoc, position: current.head };
}

export function resolveVerticalSelection(
	state: EditorState,
	forward: boolean,
	visual: VisualNavigationAdapter,
	goalX: number,
): EditorSelection | null {
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
	const projection = requireParagraphProjectionState(state);
	if (!projection.authority.complete) return null;
	const current = state.selection.main;
	const start = resolveVerticalStart(state);
	if (!start) return null;
	const bias = forward ? 1 : -1;
	const indexedCurrent = projection.rangeIndex.containingGap(current.head) !== null ||
		projection.rangeIndex.editableAnchors.includes(current.head);
	const paragraph = ordinaryParagraphAtCaret(
		state, current.head, projection.authority.paragraphs,
	);
	const boundary = blockAtPosition(projection.authority, current.head);
	let movementStart = start;
	const movementBlock = paragraph ?? boundary;
	if (movementBlock && movementBlock.from < movementBlock.to) {
		const text = state.doc.sliceString(movementBlock.from, movementBlock.to);
		const followingGap = projection.rangeIndex.gaps.find((gap) =>
			gap.from === current.head);
		const precedingGap = projection.rangeIndex.gaps.find((gap) =>
			gap.to === current.head);
		if (forward && current.head === movementBlock.to && followingGap) {
			movementStart = {
				assoc: 1,
				position: movementBlock.from + findClusterBreak(text, text.length, false),
			};
		} else if (!forward && current.head === movementBlock.from && precedingGap) {
			movementStart = {
				assoc: -1,
				position: movementBlock.from + findClusterBreak(text, 0, true),
			};
		}
	}
	const rawCandidate = visual.moveVertically(movementStart, forward, goalX);
	let candidate = rawCandidate.position === current.head
		? rawCandidate
		: visual.alignGoalOnVisualLine?.(rawCandidate, goalX) ?? rawCandidate;
	const candidateGap = projection.rangeIndex.containingGap(candidate.position);
	const crossesGap = crossesCompleteGap(projection, current.head, candidate.position);
	const destinationBlock = candidateGap
		? blockAcrossGap(projection.authority, candidateGap, forward)
		: crossesGap ? blockAtPosition(projection.authority, candidate.position) : null;
	if (destinationBlock) {
		const capabilities = capabilitiesForTopLevelBlock(destinationBlock.kind);
		if (capabilities.verticalEntry === 'host') return null;
		if (capabilities.verticalNavigation === 'host') {
			const entryRange = verticalEntryRange(state, destinationBlock, forward);
			if (!entryRange) return null;
			const entry = forward ? entryRange.from : entryRange.to;
			const alignmentAnchor = forward
				? Math.min(entryRange.to, entry + 1)
				: Math.max(entryRange.from, entry - 1);
			const entryContentCoordinates = visual.coordsAtPos({
				assoc: 1,
				position: entryRange.from,
			});
			const aligned = entryContentCoordinates && goalX <= entryContentCoordinates.left
				? { assoc: bias, position: entryRange.from }
				: visual.alignGoalOnVisualLine?.({
					assoc: bias,
					position: alignmentAnchor,
				}, goalX) ?? {
					assoc: bias,
					position: entry,
				};
			const alignedOnEntryLine = Math.max(
				entryRange.from,
				Math.min(entryRange.to, aligned.position),
			);
			candidate = {
				assoc: bias,
				position: forward
					? Math.max(entry, alignedOnEntryLine)
					: Math.min(entry, alignedOnEntryLine),
			};
		}
	}
	if (!indexedCurrent && !candidateGap && !crossesGap) return null;
	const position = normalizeBlockEndpoint(
		state,
		projection.rangeIndex.normalize(candidate.position, bias),
		bias,
	);
	if (position === current.head) return null;
	const selection = EditorSelection.create([
		EditorSelection.cursor(position, bias, undefined, goalX),
	]);
	return selection.eq(state.selection, true) ? null : selection;
}
