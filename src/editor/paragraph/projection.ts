import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import {
	Facet,
	RangeSet,
	RangeValue,
	StateField,
	type EditorState,
	type Extension,
	type Range,
	type Transaction,
} from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import { createEmptyBodies, emptyBodies } from '../runtime/empty-body-state.js';
import { codeDraft } from '../code-blocks/draft-state.js';
import { pendingMathRanges } from '../math/candidate-ranges.js';
import type {
	ParagraphAuthority,
	ParagraphBlock,
	ParagraphEndpointIndex,
	ParagraphGap,
	ParagraphPhysicalRow,
	ParagraphRun,
	TopLevelBlockBoundary,
} from './model.js';
import { capabilitiesForTopLevelBlock, createParagraphEndpointIndex, paragraphGapTags } from './model.js';
import {
	confirmedSyntaxEnd,
	discoverParagraphAuthority,
	discoverParagraphAuthorityWithin,
	hypermdBlockRangesAround,
	type ParagraphAuthoritySlice,
} from './syntax.js';

export interface ParagraphRangeIndex {
	readonly gaps: readonly ParagraphGap[];
	readonly editableAnchors: readonly number[];
	containingGap(position: number): ParagraphGap | null;
	mapEndpoint(position: number, bias: -1 | 1): number;
	normalize(position: number, bias: -1 | 1): number;
}

export interface ParagraphProjectionState {
	readonly authority: ParagraphAuthority;
	readonly decorations: DecorationSet;
	readonly atomicRanges: RangeSet<RangeValue>;
	readonly rangeIndex: ParagraphRangeIndex;
}

export interface ParagraphProjectionOptions {
	readonly isActive?: (view: EditorView) => boolean;
}

export type ParagraphProjectionWork =
	| 'analyze-full'
	| 'analyze-envelope'
	| 'build-entry'
	| 'map-entry';

interface ChangedSpan {
	readonly oldRange: ParagraphGap;
	readonly newRange: ParagraphGap;
}

interface ProjectionSyntaxAuthority {
	readonly complete: boolean;
	readonly documentLength: number;
	readonly parsedTo: number;
	readonly tree: Tree;
}

interface ParagraphProjectionEntry {
	readonly run: ParagraphRun;
	readonly envelope: ParagraphGap;
	readonly decorationValues: readonly Decoration[];
	readonly atomicValue: ParagraphGapRangeValue;
}

interface ParagraphProjectionFieldState extends ParagraphProjectionState {
	readonly runDecorations: DecorationSet;
	readonly entries: readonly ParagraphProjectionEntry[];
	readonly syntax: ProjectionSyntaxAuthority;
}

class ParagraphGapRangeValue extends RangeValue {}

const paragraphProjectionWorkObservers = Facet.define<
	(work: ParagraphProjectionWork) => void
>();

function recordProjectionWork(state: EditorState, work: ParagraphProjectionWork): void {
	for (const observer of state.facet(paragraphProjectionWorkObservers)) observer(work);
}

export function observeParagraphProjectionWork(
	observer: (work: ParagraphProjectionWork) => void,
): Extension {
	return paragraphProjectionWorkObservers.of(observer);
}

function assertDocumentPosition(position: number, documentLength: number): void {
	if (!Number.isInteger(position) || position < 0 || position > documentLength) {
		throw new RangeError('Paragraph projection position is outside the document');
	}
}

export function createParagraphRangeIndex(
	documentLength: number,
	gaps: readonly ParagraphGap[],
	editableAnchors: readonly number[],
): ParagraphRangeIndex {
	if (!Number.isInteger(documentLength) || documentLength < 0) {
		throw new RangeError('Paragraph projection document length is invalid');
	}
	const sortedGaps = Object.freeze([...gaps]
		.sort((left, right) => left.from - right.from)
		.map((gap, index, sorted) => {
			assertDocumentPosition(gap.from, documentLength);
			assertDocumentPosition(gap.to, documentLength);
			if (gap.from >= gap.to) throw new RangeError('Paragraph gap must be non-empty');
			if (index > 0 && sorted[index - 1]!.to > gap.from) {
				throw new Error('Paragraph gaps overlap');
			}
			return Object.freeze({ ...gap });
		}));
	const sortedAnchors = Object.freeze([...editableAnchors].sort((left, right) => left - right));
	let gapIndex = 0;
	for (let index = 0; index < sortedAnchors.length; index += 1) {
		const anchor = sortedAnchors[index]!;
		assertDocumentPosition(anchor, documentLength);
		if (index > 0 && sortedAnchors[index - 1] === anchor) {
			throw new Error('Paragraph editable anchors must be unique');
		}
		while (gapIndex < sortedGaps.length && sortedGaps[gapIndex]!.to <= anchor) gapIndex += 1;
		const gap = sortedGaps[gapIndex];
		if (gap && gap.from < anchor && anchor < gap.to) {
			throw new Error('Paragraph editable anchor is inside a gap');
		}
	}
	const hasZeroAnchor = sortedAnchors[0] === 0;
	const containingGap = (position: number): ParagraphGap | null => {
		assertDocumentPosition(position, documentLength);
		let low = 0, high = sortedGaps.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (sortedGaps[middle]!.from < position) low = middle + 1;
			else high = middle;
		}
		const gap = sortedGaps[position === 0 && !hasZeroAnchor ? 0 : low - 1];
		return gap && gap.from <= position && position < gap.to ? gap : null;
	};
	const normalize = (position: number, bias: -1 | 1): number => {
		assertDocumentPosition(position, documentLength);
		const gap = containingGap(position);
		return gap ? (bias < 0 && (gap.from !== 0 || hasZeroAnchor) ? gap.from : gap.to) : position;
	};
	return Object.freeze({
		gaps: sortedGaps,
		editableAnchors: sortedAnchors,
		containingGap,
		mapEndpoint: normalize,
		normalize,
	});
}

function rowClass(row: ParagraphPhysicalRow): string {
	switch (row.kind) {
		case 'gap-head': return 'paraflow-paragraph-gap-head';
		case 'editable': return 'paraflow-paragraph-empty-row';
		case 'folded': return 'paraflow-paragraph-folded-row';
	}
}

function syntaxAuthority(state: EditorState): ProjectionSyntaxAuthority {
	const tree = syntaxTree(state);
	return Object.freeze({
		complete: syntaxTreeAvailable(state, state.doc.length),
		documentLength: state.doc.length,
		parsedTo: confirmedSyntaxEnd(state),
		tree,
	});
}

function changedSpans(transaction: Transaction): readonly ChangedSpan[] {
	const spans: ChangedSpan[] = [];
	transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
		spans.push({
			newRange: { from: fromB, to: toB },
			oldRange: { from: fromA, to: toA },
		});
	});
	return spans;
}

function rangesTouch(left: ParagraphGap, right: ParagraphGap): boolean {
	return left.from <= right.to && right.from <= left.to;
}

function rangesOverlap(left: ParagraphGap, right: ParagraphGap): boolean {
	return left.from < right.to && right.from < left.to;
}

function touchesAny(range: ParagraphGap, ranges: readonly ParagraphGap[]): boolean {
	return ranges.some((candidate) => rangesTouch(range, candidate));
}

function sameRange(left: ParagraphGap, right: ParagraphGap): boolean {
	return left.from === right.from && left.to === right.to;
}

function sameRun(left: ParagraphRun, right: ParagraphRun): boolean {
	return left.kind === right.kind &&
		left.from === right.from && left.to === right.to &&
		left.gaps.length === right.gaps.length &&
		left.gaps.every((gap, index) => {
			const candidate = right.gaps[index];
			return candidate?.from === gap.from && candidate.to === gap.to;
		}) &&
		left.editableAnchors.length === right.editableAnchors.length &&
		left.editableAnchors.every((anchor, index) => right.editableAnchors[index] === anchor) &&
		left.rows.length === right.rows.length &&
		left.rows.every((row, index) => {
			const candidate = right.rows[index];
			return candidate?.at === row.at && candidate.kind === row.kind;
		});
}

function runEnvelope(
	boundaries: ParagraphEndpointIndex<ParagraphBlock>,
	run: ParagraphRun,
	documentLength: number,
): ParagraphGap {
	if (run.kind === 'leading') {
		const right = boundaries.byStart.get(run.to);
		if (!right) throw new Error('Leading paragraph run has no right boundary envelope');
		return { from: 0, to: right.to };
	}
	if (run.kind === 'trailing') {
		const left = boundaries.byEnd.get(run.from);
		if (!left) throw new Error('Trailing paragraph run has no left boundary envelope');
		return { from: left.from, to: documentLength };
	}
	const left = boundaries.byEnd.get(run.from);
	const right = boundaries.byStart.get(run.to);
	if (!left || !right) throw new Error('Middle paragraph run has an incomplete boundary envelope');
	return { from: left.from, to: right.to };
}

function decorationRanges(entry: ParagraphProjectionEntry): readonly Range<Decoration>[] {
	return entry.run.rows.map((row, index) => entry.decorationValues[index]!.range(row.at));
}

function atomicRanges(entry: ParagraphProjectionEntry): readonly Range<RangeValue>[] {
	return entry.run.gaps.map((gap) => entry.atomicValue.range(gap.from, gap.to));
}

function buildEntry(
	state: EditorState,
	blocks: readonly TopLevelBlockBoundary[],
	blockEndpoints: ParagraphEndpointIndex<TopLevelBlockBoundary>,
	boundaries: ParagraphEndpointIndex<ParagraphBlock>,
	run: ParagraphRun,
): ParagraphProjectionEntry {
	recordProjectionWork(state, 'build-entry');
	const tags = paragraphGapTags(blocks, run, blockEndpoints);
	return Object.freeze({
		atomicValue: new ParagraphGapRangeValue(),
		decorationValues: Object.freeze(run.rows.map((row) => {
			const { before, after } = tags(row.at);
			return Decoration.line({ attributes: { class: rowClass(row),
				...(row.kind === 'gap-head'
					? { 'data-paraflow-before': before, 'data-paraflow-after': after } : {}) } });
		})),
		envelope: Object.freeze(runEnvelope(boundaries, run, state.doc.length)),
		run,
	});
}

function mapRun(run: ParagraphRun, transaction: Transaction): ParagraphRun {
	const map = (position: number, association: -1 | 1): number =>
		transaction.changes.mapPos(position, association);
	const mapped = Object.freeze({
		kind: run.kind,
		from: map(run.from, -1),
		to: map(run.to, 1),
		gaps: Object.freeze(run.gaps.map((gap) => Object.freeze({
			from: map(gap.from, -1),
			to: map(gap.to, 1),
		}))),
		editableAnchors: Object.freeze(run.editableAnchors.map((anchor) => map(anchor, 1))),
		rows: Object.freeze(run.rows.map((row) => Object.freeze({
			at: map(row.at, 1),
			kind: row.kind,
		}))),
	});
	return sameRun(mapped, run) ? run : mapped;
}

function mapEntry(
	state: EditorState,
	entry: ParagraphProjectionEntry,
	transaction: Transaction,
): ParagraphProjectionEntry {
	recordProjectionWork(state, 'map-entry');
	const run = mapRun(entry.run, transaction);
	const envelope = {
		from: transaction.changes.mapPos(entry.envelope.from, -1),
		to: transaction.changes.mapPos(entry.envelope.to, 1),
	};
	if (run === entry.run && sameRange(envelope, entry.envelope)) return entry;
	return Object.freeze({
		...entry,
		envelope: Object.freeze(envelope),
		run,
	});
}

function validateEntries(
	entries: readonly ParagraphProjectionEntry[],
	documentLength: number,
): readonly ParagraphProjectionEntry[] {
	const sorted = [...entries].sort((left, right) =>
		left.run.from - right.run.from || left.run.to - right.run.to);
	for (let index = 0; index < sorted.length; index += 1) {
		const entry = sorted[index]!;
		assertDocumentPosition(entry.run.from, documentLength);
		assertDocumentPosition(entry.run.to, documentLength);
		if (entry.run.from >= entry.run.to) throw new Error('Paragraph run must be non-empty');
		if (entry.envelope.from > entry.run.from || entry.envelope.to < entry.run.to) {
			throw new Error('Paragraph run escaped its syntax envelope');
		}
		const previous = sorted[index - 1];
		if (previous && previous.run.to > entry.run.from) {
			throw new Error('Conflicting complete paragraph run ownership');
		}
	}
	return Object.freeze(sorted);
}

function authorityFor(
	complete: boolean,
	blocks: readonly TopLevelBlockBoundary[],
	entries: readonly ParagraphProjectionEntry[],
): ParagraphAuthority {
	const boundaries = blocks
		.filter(({ kind }) => capabilitiesForTopLevelBlock(kind).gapBoundary)
		.map(({ from, to }) => Object.freeze({ from, to }));
	const paragraphs = blocks
		.filter(({ kind }) => capabilitiesForTopLevelBlock(kind).paragraphEnter)
		.map(({ from, to }) => Object.freeze({ from, to }));
	return Object.freeze({
		blocks: Object.freeze([...blocks]),
		boundaries: Object.freeze([...boundaries]),
		complete,
		paragraphs: Object.freeze([...paragraphs]),
		runs: Object.freeze(entries.map((entry) => entry.run)),
	});
}

function stateFromEntries(
	state: EditorState,
	complete: boolean,
	blocks: readonly TopLevelBlockBoundary[],
	entries: readonly ParagraphProjectionEntry[],
	syntax: ProjectionSyntaxAuthority,
	decorations?: DecorationSet,
	ownedAtomicRanges?: RangeSet<RangeValue>,
): ParagraphProjectionFieldState {
	const validated = validateEntries(entries, syntax.documentLength);
	const gaps = validated.flatMap((entry) => entry.run.gaps);
	const emptyBodies = blocks.filter(block => block.kind === 'paragraph' &&
		/^[ \t]*$/u.test(state.sliceDoc(block.from, block.to)));
	const editableAnchors = [...new Set([
		...validated.flatMap((entry) => entry.run.editableAnchors),
		...emptyBodies.map(block => block.to),
	])];
	const runDecorations = decorations ?? Decoration.set(validated.flatMap(decorationRanges), true);
	return Object.freeze({
		atomicRanges: ownedAtomicRanges ?? RangeSet.of(validated.flatMap(atomicRanges), true),
		authority: authorityFor(complete, blocks, validated),
		decorations: runDecorations.update({ add: emptyBodies.map(block =>
			Decoration.line({ attributes: { class: 'paraflow-paragraph-empty-row' } }).range(block.from)), sort: true }),
		runDecorations,
		entries: validated,
		rangeIndex: createParagraphRangeIndex(syntax.documentLength, gaps, editableAnchors),
		syntax,
	});
}

function rebuildAll(state: EditorState): ParagraphProjectionFieldState {
	recordProjectionWork(state, 'analyze-full');
	const syntax = syntaxAuthority(state);
	const authority = discoverParagraphAuthority(state);
	const blocks = createParagraphEndpointIndex(authority.blocks);
	const boundaries = createParagraphEndpointIndex(authority.boundaries);
	const entries = authority.runs.map((run) => buildEntry(state, authority.blocks, blocks, boundaries, run));
	return stateFromEntries(
		state,
		authority.complete,
		authority.blocks,
		entries,
		syntax,
	);
}

function localAuthority(
	state: EditorState,
	ranges: readonly ParagraphGap[],
): ParagraphAuthoritySlice {
	recordProjectionWork(state, 'analyze-envelope');
	return discoverParagraphAuthorityWithin(state, ranges);
}

function mapBlock(
	block: TopLevelBlockBoundary,
	transaction: Transaction,
): TopLevelBlockBoundary {
	return Object.freeze({
		...block,
		from: transaction.changes.mapPos(block.from, 1),
		kind: block.kind,
		to: transaction.changes.mapPos(block.to, -1),
	});
}

function mapContainingRange(
	range: ParagraphGap,
	transaction: Transaction,
): ParagraphGap {
	return Object.freeze({
		from: transaction.changes.mapPos(range.from, -1),
		to: transaction.changes.mapPos(range.to, 1),
	});
}

function mergeBlocks(
	previous: readonly TopLevelBlockBoundary[],
	replacements: readonly TopLevelBlockBoundary[],
	coveredRanges: readonly ParagraphGap[],
	transaction: Transaction,
	spans: readonly ChangedSpan[],
): readonly TopLevelBlockBoundary[] {
	const oldRanges = spans.map((span) => span.oldRange);
	const blocks = [
		...previous
			.filter((block) => !touchesAny(block, oldRanges))
			.map((block) => mapBlock(block, transaction))
			.filter((block) => !coveredRanges.some((covered) =>
				rangesOverlap(block, covered)))
			.filter((block) => !replacements.some((replacement) =>
				rangesOverlap(block, replacement) || sameRange(block, replacement))),
		...replacements,
	].sort((left, right) => left.from - right.from || left.to - right.to);
	for (let index = 1; index < blocks.length; index += 1) {
		if (blocks[index - 1]!.to > blocks[index]!.from) {
			throw new Error('Conflicting complete paragraph authority block ownership');
		}
	}
	return Object.freeze(blocks);
}

function updateRangeSets(
	value: ParagraphProjectionFieldState,
	transaction: Transaction,
	removed: readonly ParagraphProjectionEntry[],
	added: readonly ParagraphProjectionEntry[],
): { readonly atomicRanges: RangeSet<RangeValue>; readonly decorations: DecorationSet } {
	const removedDecorations = new Set(removed.flatMap((entry) => entry.decorationValues));
	const removedAtomicValues = new Set(removed.map((entry) => entry.atomicValue));
	return {
		atomicRanges: value.atomicRanges.map(transaction.changes).update({
			add: added.flatMap(atomicRanges),
			filter: (_from, _to, rangeValue) => !removedAtomicValues.has(rangeValue),
			sort: true,
		}),
		decorations: value.runDecorations.map(transaction.changes).update({
			add: added.flatMap(decorationRanges),
			filter: (_from, _to, decoration) => !removedDecorations.has(decoration),
			sort: true,
		}),
	};
}

function updateCompleteDocument(
	value: ParagraphProjectionFieldState,
	transaction: Transaction,
	spans: readonly ChangedSpan[],
	syntax: ProjectionSyntaxAuthority,
): ParagraphProjectionFieldState {
	const oldRanges = spans.map((span) => span.oldRange);
	const newRanges = spans.map((span) => span.newRange);
	const oldBlockRanges = hypermdBlockRangesAround(transaction.startState, oldRanges);
	const mappedOldBlockRanges = oldBlockRanges.map((range) =>
		mapContainingRange(range, transaction));
	const newBlockRanges = hypermdBlockRangesAround(transaction.state, newRanges);
	const invalidatedNewRanges = [...newRanges, ...mappedOldBlockRanges, ...newBlockRanges];
	const removed = value.entries.filter((entry) =>
		touchesAny(entry.envelope, oldRanges) ||
		invalidatedNewRanges.some((range) =>
			rangesOverlap(mapContainingRange(entry.envelope, transaction), range)));
	const removedValues = new Set(removed.map((entry) => entry.atomicValue));
	const mappedUnaffected = value.entries
		.filter((entry) => !removedValues.has(entry.atomicValue))
		.map((entry) => mapEntry(transaction.state, entry, transaction));
	const analysisRanges = [
		...invalidatedNewRanges,
		...removed.map((entry) => mapContainingRange(entry.envelope, transaction)),
	];
	const localSlice = localAuthority(transaction.state, analysisRanges);
	const local = localSlice.authority;
	if (!local.complete) throw new Error('Complete syntax authority became incomplete during analysis');
	const blockEndpoints = createParagraphEndpointIndex(local.blocks);
	const boundaries = createParagraphEndpointIndex(local.boundaries);
	const localRuns = local.runs
		.map((run) => ({ envelope: runEnvelope(boundaries, run, transaction.state.doc.length), run }));
	const reusedRuns = new Set<ParagraphRun>();
	const unaffected = mappedUnaffected.map((entry) => {
		const localRun = localRuns.find(({ run }) => sameRun(entry.run, run));
		if (!localRun) return entry;
		reusedRuns.add(localRun.run);
		if (sameRange(entry.envelope, localRun.envelope)) return entry;
		return Object.freeze({
			...entry,
			envelope: Object.freeze(localRun.envelope),
		});
	});
	const added = localRuns
		.filter(({ run }) => !reusedRuns.has(run))
		.map(({ run }) => buildEntry(transaction.state, local.blocks, blockEndpoints, boundaries, run));
	const rangeSets = updateRangeSets(value, transaction, removed, added);
	const blocks = mergeBlocks(
		value.authority.blocks,
		local.blocks,
		localSlice.coveredRanges,
		transaction,
		spans,
	);
	return stateFromEntries(
		transaction.state,
		true,
		blocks,
		[...unaffected, ...added],
		syntax,
		rangeSets.decorations,
		rangeSets.atomicRanges,
	);
}

export const paragraphProjectionField = StateField.define<ParagraphProjectionFieldState>({
	create: rebuildAll,
	update(value, transaction) {
		const syntax = syntaxAuthority(transaction.state);
		const oldMath = pendingMathRanges(transaction.startState), newMath = pendingMathRanges(transaction.state);
		if (oldMath !== newMath && (oldMath.length || newMath.length)) return rebuildAll(transaction.state);
		const oldDraft = transaction.startState.facet(codeDraft), newDraft = transaction.state.facet(codeDraft);
		if (oldDraft || newDraft) {
			if (transaction.docChanged || oldDraft?.from !== newDraft?.from || oldDraft?.to !== newDraft?.to || oldDraft?.end !== newDraft?.end) return rebuildAll(transaction.state);
		}
		if (emptyBodies(transaction.startState) !== emptyBodies(transaction.state) &&
			(emptyBodies(transaction.startState).length || emptyBodies(transaction.state).length)) return rebuildAll(transaction.state);
		if (!transaction.docChanged) {
			if (value.syntax.tree === syntax.tree &&
				value.syntax.complete === syntax.complete &&
				value.syntax.documentLength === syntax.documentLength &&
				value.syntax.parsedTo === syntax.parsedTo) return value;
			return rebuildAll(transaction.state);
		}
		const spans = changedSpans(transaction);
		if (!syntax.complete) {
			return rebuildAll(transaction.state);
		}
		if (!value.authority.complete) return rebuildAll(transaction.state);
		return updateCompleteDocument(value, transaction, spans, syntax);
	},
});

export function getParagraphProjectionState(
	state: EditorState,
): ParagraphProjectionState | null {
	return state.field(paragraphProjectionField, false) ?? null;
}

export function requireParagraphProjectionState(state: EditorState): ParagraphProjectionState {
	const value = getParagraphProjectionState(state);
	if (!value) throw new Error('Paragraph projection state is required');
	return value;
}

export function createParagraphProjection(
	options: ParagraphProjectionOptions = {},
): Extension {
	const isActive = options.isActive ?? (() => true);
	return [
		createEmptyBodies(),
		paragraphProjectionField,
		EditorView.decorations.of((view) =>
			isActive(view) ? requireParagraphProjectionState(view.state).decorations : Decoration.none),
		EditorView.atomicRanges.of((view) =>
			isActive(view) ? requireParagraphProjectionState(view.state).atomicRanges : RangeSet.empty),
	];
}
