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
import type {
	ParagraphAuthority,
	ParagraphGap,
	ParagraphPhysicalRow,
	ParagraphRun,
	TopLevelBlockBoundary,
} from './model.js';
import { capabilitiesForTopLevelBlock } from './model.js';
import {
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
	for (let index = 0; index < sortedAnchors.length; index += 1) {
		const anchor = sortedAnchors[index]!;
		assertDocumentPosition(anchor, documentLength);
		if (index > 0 && sortedAnchors[index - 1] === anchor) {
			throw new Error('Paragraph editable anchors must be unique');
		}
		if (sortedGaps.some((gap) => gap.from < anchor && anchor < gap.to)) {
			throw new Error('Paragraph editable anchor is inside a gap');
		}
	}
	const containingGap = (position: number): ParagraphGap | null => {
		assertDocumentPosition(position, documentLength);
		return sortedGaps.find((gap) => gap.from < position && position < gap.to) ?? null;
	};
	const normalize = (position: number, bias: -1 | 1): number => {
		assertDocumentPosition(position, documentLength);
		const gap = containingGap(position);
		return gap ? (bias < 0 ? gap.from : gap.to) : position;
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
		parsedTo: tree.length,
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
	authority: ParagraphAuthority,
	run: ParagraphRun,
	documentLength: number,
): ParagraphGap {
	if (run.kind === 'leading') {
		const right = authority.boundaries.find((boundary) => boundary.from === run.to);
		if (!right) throw new Error('Leading paragraph run has no right boundary envelope');
		return { from: 0, to: right.to };
	}
	if (run.kind === 'trailing') {
		const left = authority.boundaries.find((boundary) => boundary.to === run.from);
		if (!left) throw new Error('Trailing paragraph run has no left boundary envelope');
		return { from: left.from, to: documentLength };
	}
	const left = authority.boundaries.find((boundary) => boundary.to === run.from);
	const right = authority.boundaries.find((boundary) => boundary.from === run.to);
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
	authority: ParagraphAuthority,
	run: ParagraphRun,
): ParagraphProjectionEntry {
	recordProjectionWork(state, 'build-entry');
	return Object.freeze({
		atomicValue: new ParagraphGapRangeValue(),
		decorationValues: Object.freeze(run.rows.map((row) =>
			Decoration.line({ attributes: { class: rowClass(row) } }))),
		envelope: Object.freeze(runEnvelope(authority, run, state.doc.length)),
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
	const boundaries = complete
		? blocks
			.filter(({ kind }) => capabilitiesForTopLevelBlock(kind).gapBoundary)
			.map(({ from, to }) => Object.freeze({ from, to }))
		: [];
	const paragraphs = complete
		? blocks
			.filter(({ kind }) => capabilitiesForTopLevelBlock(kind).paragraphEnter)
			.map(({ from, to }) => Object.freeze({ from, to }))
		: [];
	return Object.freeze({
		blocks: Object.freeze([...blocks]),
		boundaries: Object.freeze([...boundaries]),
		complete,
		paragraphs: Object.freeze([...paragraphs]),
		runs: Object.freeze(entries.map((entry) => entry.run)),
	});
}

function stateFromEntries(
	complete: boolean,
	blocks: readonly TopLevelBlockBoundary[],
	entries: readonly ParagraphProjectionEntry[],
	syntax: ProjectionSyntaxAuthority,
	decorations?: DecorationSet,
	ownedAtomicRanges?: RangeSet<RangeValue>,
): ParagraphProjectionFieldState {
	const validated = validateEntries(entries, syntax.documentLength);
	const gaps = validated.flatMap((entry) => entry.run.gaps);
	const editableAnchors = validated.flatMap((entry) => entry.run.editableAnchors);
	return Object.freeze({
		atomicRanges: ownedAtomicRanges ?? RangeSet.of(validated.flatMap(atomicRanges), true),
		authority: authorityFor(complete, blocks, validated),
		decorations: decorations ?? Decoration.set(validated.flatMap(decorationRanges), true),
		entries: validated,
		rangeIndex: createParagraphRangeIndex(syntax.documentLength, gaps, editableAnchors),
		syntax,
	});
}

function rebuildAll(state: EditorState): ParagraphProjectionFieldState {
	recordProjectionWork(state, 'analyze-full');
	const syntax = syntaxAuthority(state);
	const authority = discoverParagraphAuthority(state);
	const entries = authority.complete
		? authority.runs.map((run) => buildEntry(state, authority, run))
		: [];
	return stateFromEntries(
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
				rangesOverlap(block, replacement))),
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
		decorations: value.decorations.map(transaction.changes).update({
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
	const localRuns = local.runs
		.map((run) => ({ envelope: runEnvelope(local, run, transaction.state.doc.length), run }));
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
		.map(({ run }) => buildEntry(transaction.state, local, run));
	const rangeSets = updateRangeSets(value, transaction, removed, added);
	const blocks = mergeBlocks(
		value.authority.blocks,
		local.blocks,
		localSlice.coveredRanges,
		transaction,
		spans,
	);
	return stateFromEntries(
		true,
		blocks,
		[...unaffected, ...added],
		syntax,
		rangeSets.decorations,
		rangeSets.atomicRanges,
	);
}

function updateIncompleteDocument(
	value: ParagraphProjectionFieldState,
	transaction: Transaction,
	spans: readonly ChangedSpan[],
	syntax: ProjectionSyntaxAuthority,
): ParagraphProjectionFieldState {
	if (!value.authority.complete) {
		return stateFromEntries(false, [], [], syntax, Decoration.none, RangeSet.empty);
	}
	const firstUncertainPosition = Math.min(...spans.map((span) => span.oldRange.from));
	const safe = value.entries.filter((entry) => entry.envelope.to < firstUncertainPosition);
	const removed = value.entries.filter((entry) => !safe.includes(entry));
	const mapped = safe
		.map((entry) => mapEntry(transaction.state, entry, transaction))
		.filter((entry) => entry.envelope.to <= syntax.parsedTo);
	const retainedValues = new Set(mapped.map((entry) => entry.atomicValue));
	const additionallyRemoved = safe.filter((entry) => !retainedValues.has(entry.atomicValue));
	const rangeSets = updateRangeSets(
		value,
		transaction,
		[...removed, ...additionallyRemoved],
		[],
	);
	return stateFromEntries(
		false,
		[],
		mapped,
		syntax,
		rangeSets.decorations,
		rangeSets.atomicRanges,
	);
}

function updateNonDocumentSyntax(
	value: ParagraphProjectionFieldState,
	state: EditorState,
	syntax: ProjectionSyntaxAuthority,
): ParagraphProjectionFieldState {
	if (syntax.complete) return rebuildAll(state);
	if (value.authority.complete) {
		return stateFromEntries(false, [], [], syntax, Decoration.none, RangeSet.empty);
	}
	const retained = value.entries.filter((entry) => entry.envelope.to <= syntax.parsedTo);
	if (retained.length === value.entries.length) {
		return Object.freeze({
			...value,
			authority: authorityFor(false, [], retained),
			syntax,
		});
	}
	const removed = value.entries.filter((entry) => !retained.includes(entry));
	const removedDecorations = new Set(removed.flatMap((entry) => entry.decorationValues));
	const removedAtomicValues = new Set(removed.map((entry) => entry.atomicValue));
	return stateFromEntries(
		false,
		[],
		retained,
		syntax,
		value.decorations.update({
			filter: (_from, _to, decoration) => !removedDecorations.has(decoration),
		}),
		value.atomicRanges.update({
			filter: (_from, _to, rangeValue) => !removedAtomicValues.has(rangeValue),
		}),
	);
}

export const paragraphProjectionField = StateField.define<ParagraphProjectionFieldState>({
	create: rebuildAll,
	update(value, transaction) {
		const syntax = syntaxAuthority(transaction.state);
		if (!transaction.docChanged) {
			if (value.syntax.tree === syntax.tree &&
				value.syntax.complete === syntax.complete &&
				value.syntax.documentLength === syntax.documentLength &&
				value.syntax.parsedTo === syntax.parsedTo) return value;
			return updateNonDocumentSyntax(value, transaction.state, syntax);
		}
		const spans = changedSpans(transaction);
		if (!syntax.complete) {
			return updateIncompleteDocument(value, transaction, spans, syntax);
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
		paragraphProjectionField,
		EditorView.decorations.of((view) =>
			isActive(view) ? requireParagraphProjectionState(view.state).decorations : Decoration.none),
		EditorView.atomicRanges.of((view) =>
			isActive(view) ? requireParagraphProjectionState(view.state).atomicRanges : RangeSet.empty),
	];
}
