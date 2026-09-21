import {
	EditorSelection,
	type EditorState,
	type Extension,
	type SelectionRange,
} from '@codemirror/state';
import {
	EditorView,
	layer,
	RectangleMarker,
	ViewPlugin,
	type LayerMarker,
	type ViewUpdate,
} from '@codemirror/view';
import {
	getStructuredListProjectionState,
	getStructuredListSelectionTransparentRanges,
} from '../structured-list/projection.js';
import type { SourceRange } from '../structured-list/model.js';
import { getParagraphProjectionState } from './projection.js';

const ACTIVE_CLASS = 'paraflow-gap-selection-presentation-active';

export interface GapSelectionPresentationOptions {
	readonly isActive: (view: EditorView) => boolean;
}

function markerOnlyPrefixRange(
	state: EditorState,
	prefix: SourceRange,
): SourceRange {
	const line = state.doc.lineAt(prefix.from);
	return line.from === prefix.from && line.to === prefix.to && line.to < state.doc.length
		? { from: prefix.from, to: prefix.to + 1 }
		: prefix;
}

function mergeSourceRanges(ranges: readonly SourceRange[]): readonly SourceRange[] {
	const sorted = [...ranges]
		.sort((left, right) => left.from - right.from || left.to - right.to);
	const merged: SourceRange[] = [];
	for (const range of sorted) {
		const previous = merged.at(-1);
		if (!previous || range.from > previous.to) {
			merged.push({ from: range.from, to: range.to });
		} else if (range.to > previous.to) {
			merged[merged.length - 1] = { from: previous.from, to: range.to };
		}
	}
	return merged;
}

function rangeKey(range: SourceRange): string {
	return `${range.from}:${range.to}`;
}

function lowerBound(values: readonly number[], value: number): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (values[middle]! < value) low = middle + 1;
		else high = middle;
	}
	return low;
}

function subtractPreservedRanges(
	gap: SourceRange,
	preservedRanges: readonly SourceRange[],
): readonly SourceRange[] {
	if (preservedRanges.length === 0) return [gap];
	const ranges: SourceRange[] = [];
	let from = gap.from;
	for (const preserved of preservedRanges) {
		const preservedFrom = Math.max(gap.from, preserved.from);
		const preservedTo = Math.min(gap.to, preserved.to);
		if (from < preservedFrom) ranges.push({ from, to: preservedFrom });
		from = Math.max(from, preservedTo);
	}
	if (from < gap.to) ranges.push({ from, to: gap.to });
	return ranges;
}

function selectionExclusions(
	state: EditorState,
	structuralGaps: readonly SourceRange[],
	protectedPrefixes: readonly SourceRange[],
): readonly SourceRange[] {
	const editableAnchors = getParagraphProjectionState(state)?.rangeIndex.editableAnchors ?? [];
	const listGaps = getStructuredListSelectionTransparentRanges(state);
	const orderedListGaps = [...listGaps].sort((left, right) =>
		left.from - right.from || left.to - right.to);
	const editableBoundaries = new Map<string, SourceRange>();
	for (let index = 0; index < orderedListGaps.length - 1; index += 1) {
		const gap = orderedListGaps[index]!;
		const next = orderedListGaps[index + 1]!;
		if (gap.to !== next.from) continue;
		const line = state.doc.lineAt(gap.to);
		if (line.from !== gap.to || line.length !== 0 || line.number === state.doc.lines) continue;
		editableBoundaries.set(rangeKey(next), {
			from: gap.to,
			to: state.doc.line(line.number + 1).from,
		});
	}
	const orderedGaps = [...structuralGaps].sort((left, right) =>
		left.from - right.from || left.to - right.to);
	const listGapKeys = new Set(listGaps.map(rangeKey));
	const normalizedGaps = orderedGaps.flatMap((gap) => {
		const anchorIndex = lowerBound(editableAnchors, gap.from);
		const preservedRanges: SourceRange[] = [];
		for (let index = anchorIndex; index < editableAnchors.length; index += 1) {
			const anchor = editableAnchors[index]!;
			if (anchor >= gap.to) break;
			preservedRanges.push({ from: anchor, to: anchor + 1 });
		}
		if (listGapKeys.has(rangeKey(gap))) {
			const boundary = editableBoundaries.get(rangeKey(gap));
			if (boundary) preservedRanges.unshift(boundary);
		}
		return subtractPreservedRanges(gap, preservedRanges);
	});
	return mergeSourceRanges([
		...normalizedGaps,
		...protectedPrefixes.map((prefix) => markerOnlyPrefixRange(state, prefix)),
	]);
}

function selectionPresentationExclusions(state: EditorState): readonly SourceRange[] {
	return selectionExclusions(
		state,
		structuralGaps(state),
		getStructuredListProjectionState(state)?.rangeIndex.protectedRanges ?? [],
	);
}

class SelectionExclusionSnapshot {
	private paragraph = getParagraphProjectionState(this.view.state);
	private structuredList = getStructuredListProjectionState(this.view.state);
	ranges = selectionPresentationExclusions(this.view.state);

	constructor(private readonly view: EditorView) {}

	update(update: ViewUpdate): void {
		const paragraph = getParagraphProjectionState(update.state);
		const structuredList = getStructuredListProjectionState(update.state);
		if (!update.docChanged && paragraph === this.paragraph &&
			structuredList === this.structuredList) return;
		this.paragraph = paragraph;
		this.structuredList = structuredList;
		this.ranges = selectionPresentationExclusions(update.state);
	}
}

const selectionExclusionSnapshotPlugin = ViewPlugin.fromClass(SelectionExclusionSnapshot);

export function selectionPresentationExclusionsForView(
	view: EditorView,
): readonly SourceRange[] {
	const snapshot = view.plugin(selectionExclusionSnapshotPlugin);
	if (!snapshot) throw new Error('Selection exclusion snapshot is not installed');
	return snapshot.ranges;
}

function selectionFragmentsFromExclusions(
	ranges: readonly SelectionRange[],
	exclusions: readonly SourceRange[],
): readonly SelectionRange[] {
	const fragments: SourceRange[] = [];
	for (const range of ranges) {
		if (range.empty) continue;
		let cursor = range.from;
		let low = 0;
		let high = exclusions.length;
		while (low < high) {
			const middle = low + Math.floor((high - low) / 2);
			if (exclusions[middle]!.to <= cursor) low = middle + 1;
			else high = middle;
		}
		for (let index = low; index < exclusions.length; index += 1) {
			const exclusion = exclusions[index]!;
			if (exclusion.to <= cursor) continue;
			if (exclusion.from >= range.to) break;
			if (cursor < exclusion.from) {
				fragments.push({ from: cursor, to: Math.min(exclusion.from, range.to) });
			}
			cursor = Math.max(cursor, exclusion.to);
			if (cursor >= range.to) break;
		}
		if (cursor < range.to) fragments.push({ from: cursor, to: range.to });
	}
	return mergeSourceRanges(fragments).map(({ from, to }) => EditorSelection.range(from, to));
}

function lineLocalPaintRanges(
	state: EditorState,
	fragments: readonly SelectionRange[],
): readonly SelectionRange[] {
	const ranges: SelectionRange[] = [];
	for (const fragment of fragments) {
		const firstLine = state.doc.lineAt(fragment.from).number;
		const lastLine = state.doc.lineAt(fragment.to).number;
		for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
			const line = state.doc.line(lineNumber);
			const from = Math.max(fragment.from, line.from);
			const to = Math.min(fragment.to, line.to);
			if (from < to) {
				ranges.push(EditorSelection.range(from, to));
			}
		}
	}
	return ranges;
}

export function selectionSourceFragments(
	state: EditorState,
	ranges: readonly SelectionRange[],
	structuralGaps: readonly SourceRange[],
	protectedPrefixes: readonly SourceRange[],
): readonly SelectionRange[] {
	return selectionFragmentsFromExclusions(
		ranges,
		selectionExclusions(state, structuralGaps, protectedPrefixes),
	);
}

export function selectionPaintRanges(
	state: EditorState,
	ranges: readonly SelectionRange[],
	structuralGaps: readonly SourceRange[],
	protectedPrefixes: readonly SourceRange[],
): readonly SelectionRange[] {
	return lineLocalPaintRanges(
		state,
		selectionFragmentsFromExclusions(
			ranges,
			selectionExclusions(state, structuralGaps, protectedPrefixes),
		),
	);
}

function intersectRanges(
	ranges: readonly SelectionRange[],
	visibleRanges: readonly SourceRange[],
): readonly SelectionRange[] {
	const intersections: SelectionRange[] = [];
	for (const range of ranges) {
		if (range.empty) continue;
		for (const visible of visibleRanges) {
			if (visible.to <= range.from) continue;
			if (visible.from >= range.to) break;
			const from = Math.max(range.from, visible.from);
			const to = Math.min(range.to, visible.to);
			if (from < to) intersections.push(EditorSelection.range(from, to));
		}
	}
	return intersections;
}

export function selectionPaintRangesInVisibleRanges(
	state: EditorState,
	ranges: readonly SelectionRange[],
	visibleRanges: readonly SourceRange[],
	exclusions: readonly SourceRange[],
): readonly SelectionRange[] {
	return lineLocalPaintRanges(
		state,
		selectionFragmentsFromExclusions(
			intersectRanges(ranges, visibleRanges),
			exclusions,
		),
	);
}

function structuralGaps(state: EditorState): readonly SourceRange[] {
	return [
		...(getParagraphProjectionState(state)?.rangeIndex.gaps ?? []),
		...getStructuredListSelectionTransparentRanges(state),
	];
}

function presentsSelection(view: EditorView, options: GapSelectionPresentationOptions): boolean {
	return options.isActive(view);
}

function projectionChanged(update: ViewUpdate): boolean {
	return getParagraphProjectionState(update.startState) !==
		getParagraphProjectionState(update.state) ||
		getStructuredListProjectionState(update.startState) !==
		getStructuredListProjectionState(update.state);
}

export function createGapSelectionPresentation(
	options: GapSelectionPresentationOptions,
): Extension {
	return [
		selectionExclusionSnapshotPlugin,
		EditorView.editorAttributes.of((view) => ({
			class: presentsSelection(view, options) ? ACTIVE_CLASS : '',
		})),
		layer({
			above: false,
			class: 'paraflow-gap-selection-layer',
			markers(view): readonly LayerMarker[] {
				if (!presentsSelection(view, options)) return [];
				const paintRanges = selectionPaintRangesInVisibleRanges(
					view.state,
					view.state.selection.ranges,
					view.visibleRanges,
					selectionPresentationExclusionsForView(view),
				);
				return paintRanges.flatMap((fragment) =>
					RectangleMarker.forRange(view, 'cm-selectionBackground', fragment));
			},
			update(update): boolean {
				return update.docChanged || update.selectionSet || update.viewportChanged ||
					update.geometryChanged || projectionChanged(update);
			},
		}),
	];
}
