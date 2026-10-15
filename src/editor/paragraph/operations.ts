import { EditorSelection, findClusterBreak, type EditorState } from '@codemirror/state';
import type { VisualAssociation, VisualNavigationAdapter } from '../runtime/navigation-core.js';
import type { ParagraphEditPlan } from './edit-plan.js';
import { bodyEnterText } from './body-enter.js';
import { requireParagraphProjectionState } from './projection.js';
import { ordinaryParagraphAtCaret } from './syntax.js';
import { discoverInlineSemanticConstructs, literalFormattingMarkers } from './inline-selection-projection.js';
import {
	headingAtCaret,
	getHeadingProjectionState,
	normalizeHeadingSelectionEndpoint,
} from './heading-projection.js';
import { verticalEntryRange } from './syntax.js';
import { normalizeStructuredListSelectionEndpoint } from '../structured-list/selection-protection.js';
import { getStructuredListBlankRuns } from '../structured-list/projection.js';
import { capabilitiesForTopLevelBlock } from './model.js';
import type { ParagraphAuthority, TopLevelBlockBoundary } from './model.js';
import { discoverSetextHeadings } from './setext.js';

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
	const position = state.selection.main.head;
	const setext = discoverSetextHeadings(state).find(heading => heading.contentFrom <= position && position <= heading.contentTo);
	// Typora's Setext Shift-Enter follows the same structural split as Enter.
	if (setext) {
		const prefix = state.sliceDoc(setext.from, setext.contentFrom);
		const atStart = position === setext.contentFrom, atEnd = position === setext.contentTo;
		const from = atStart ? setext.from : atEnd ? setext.to : position;
		const insert = atStart ? `${prefix}\n${prefix}\n` : atEnd ? `\n${prefix}\n${prefix}`
			: `\n${state.sliceDoc(setext.underlineFrom, setext.underlineTo)}\n${prefix}\n${prefix}`;
		return Object.freeze({ operation, isolateHistory: true,
			change: Object.freeze({ from, to: from, insert }), ownedRange: setext,
			selection: EditorSelection.create([EditorSelection.cursor((atStart ? position : from) + insert.length)]) });
	}
	if (operation === 'enter') {
		const headingProjection = getHeadingProjectionState(state);
		const heading = headingProjection?.headings.find(candidate => candidate.contentFrom <= position && position <= candidate.to &&
			candidate.from !== headingProjection.editSession?.lineFrom);
		if (heading) {
			const atStart = position === heading.contentFrom;
			const from = atStart ? heading.from : position;
			const insert = position !== heading.to && !atStart
				? '\n\n' + state.sliceDoc(heading.from, heading.contentFrom) : '\n\n';
			return Object.freeze({ operation, isolateHistory: true,
				change: Object.freeze({ from, to: from, insert }), ownedRange: heading,
				selection: EditorSelection.create([EditorSelection.cursor(position + insert.length)]) });
		}
	}
	const paragraph = ordinaryParagraphAtCaret(
		state,
		position,
		projection.authority.paragraphs,
	) ?? literalParagraphAtEdge(state, position, projection.authority.paragraphs);
	const editableAnchor = projection.rangeIndex.editableAnchors.includes(position);
	if (!paragraph && !editableAnchor) return null;
	const atEditableAnchor = !paragraph && editableAnchor;
	const insert = bodyEnterText(operation);
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

function literalParagraphAtEdge(state: EditorState, position: number, paragraphs: ParagraphAuthority['paragraphs']) {
	const paragraph = paragraphs.find(candidate => candidate.from <= position && position <= candidate.to);
	if (!paragraph) return null;
	if (literalFormattingMarkers(state, [paragraph]).some(range => range.from <= position && position <= range.to)) return paragraph;
	return discoverInlineSemanticConstructs(state, [EditorSelection.cursor(position)]).some(item =>
		item.kind === 'escape' && (item.editFrom === position || item.editTo === position)) ? paragraph : null;
}

export function planGapDeletion(
	state: EditorState,
	operation: ParagraphDeletionOperation,
): ParagraphEditPlan | null {
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
	const projection = requireParagraphProjectionState(state);
	const position = state.selection.main.head;
	if (operation === 'backspace' && /^[ \t]*$/u.test(state.doc.lineAt(position).text)) {
		for (const run of getStructuredListBlankRuns(state)) {
			const body = run.editableBodies.find(candidate => candidate.to === position);
			const preceding = body && run.transparentRanges.find(gap => gap.to === body.from);
			if (!body || !preceding) continue;
			const lastBody = run.editableBodies.length === 1;
			const ownedRange = lastBody ? run.range : { from: preceding.from, to: body.to };
			return Object.freeze({ change: Object.freeze({ ...ownedRange, insert: lastBody ? '\n' : '' }), isolateHistory: true,
				operation: 'backspace-gap', ownedRange,
				selection: EditorSelection.create([EditorSelection.cursor(preceding.from, 1)]) });
		}
	}
	if (operation === 'backspace') {
		const emptyBody = projection.authority.paragraphs.find(paragraph => paragraph.to === position &&
			/^[ \t]*$/u.test(state.sliceDoc(paragraph.from, paragraph.to)));
		const preceding = emptyBody && projection.rangeIndex.gaps.find(gap => gap.to === emptyBody.from);
		if (emptyBody && preceding) {
			const ownedRange = { from: preceding.from, to: emptyBody.to };
			return Object.freeze({
				change: Object.freeze({ ...ownedRange, insert: '' }),
				operation: 'backspace-gap',
				ownedRange,
				selection: EditorSelection.create([EditorSelection.cursor(preceding.from, 1)]),
			});
		}
	}
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
	const current = state.selection.main;
	const indexedCurrent = projection.rangeIndex.containingGap(current.head) !== null ||
		projection.rangeIndex.editableAnchors.includes(current.head);
	const block = indexedCurrent
		? null
		: blockAtPosition(projection.authority, current.head);
	if (!indexedCurrent && (!block ||
		capabilitiesForTopLevelBlock(block.kind).verticalNavigation === 'host')) return null;
	return {
		assoc: verticalAssociation(state, current.head, current.assoc),
		position: current.head,
	};
}

function verticalAssociation(
	state: EditorState,
	position: number,
	assoc: VisualAssociation,
): VisualAssociation {
	const headings = getHeadingProjectionState(state);
	// A body-start caret belongs to visible text, never the zero-height prefix widget.
	return headings?.headings.some((heading) =>
		heading.contentFrom === position && heading.from !== headings.editSession?.lineFrom)
		? 1
		: assoc;
}

export function resolveVerticalSelection(
	state: EditorState,
	forward: boolean,
	visual: VisualNavigationAdapter,
	goalX: number,
): EditorSelection | null {
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
	const projection = requireParagraphProjectionState(state);
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
		EditorSelection.cursor(position, verticalAssociation(
			state,
			position,
			position === candidate.position ? candidate.assoc : bias,
		), undefined, goalX),
	]);
	return selection.eq(state.selection, true) ? null : selection;
}
