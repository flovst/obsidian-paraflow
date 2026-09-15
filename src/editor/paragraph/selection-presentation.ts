import {
	EditorSelection,
	type EditorState,
	type Extension,
	type SelectionRange,
} from '@codemirror/state';
import {
	Direction,
	EditorView,
	layer,
	RectangleMarker,
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

export function selectionLineSegments(
	state: EditorState,
	ranges: readonly SelectionRange[],
	gaps: readonly SourceRange[],
): readonly SelectionRange[] {
	return ranges.flatMap((range) => {
		if (range.empty) return [];
		const segments: SelectionRange[] = [];
		const firstLine = state.doc.lineAt(range.from).number;
		const lastLine = state.doc.lineAt(range.to).number;
		for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
			const line = state.doc.line(lineNumber);
			const transparent = gaps.some((gap) =>
				(gap.from < line.from || gap.from === 0 && line.from === 0) &&
				line.to < gap.to);
			if (transparent) continue;
			const from = Math.max(range.from, line.from);
			const to = Math.min(range.to, line.to);
			if (from < to) {
				segments.push(EditorSelection.range(from, to));
				continue;
			}
			if (line.length === 0 && lineNumber < state.doc.lines) {
				const newlineTo = state.doc.line(lineNumber + 1).from;
				const newlineFrom = Math.max(range.from, line.to);
				const selectedNewlineTo = Math.min(range.to, newlineTo);
				if (newlineFrom < selectedNewlineTo) {
					segments.push(EditorSelection.range(newlineFrom, selectedNewlineTo));
				}
			}
		}
		return segments;
	});
}

function structuralGaps(state: EditorState): readonly SourceRange[] {
	return [
		...(getParagraphProjectionState(state)?.rangeIndex.gaps ?? []),
		...getStructuredListSelectionTransparentRanges(state),
	];
}

function intersectsGap(range: SelectionRange, gap: SourceRange): boolean {
	return range.from < gap.to && gap.from < range.to;
}

function ownsSelection(view: EditorView, options: GapSelectionPresentationOptions): boolean {
	if (!options.isActive(view)) return false;
	const gaps = structuralGaps(view.state);
	return view.state.selection.ranges.some((range) =>
		!range.empty && gaps.some((gap) => intersectsGap(range, gap)));
}

function markersForLine(view: EditorView, range: SelectionRange): readonly LayerMarker[] {
	const line = view.state.doc.lineAt(range.from);
	if (range.to > line.to) {
		return RectangleMarker.forRange(view, 'cm-selectionBackground', range);
	}
	const prefix = getStructuredListProjectionState(view.state)?.rangeIndex.protectedRanges
		.find(({ from }) => from === line.from);
	const visibleFrom = Math.max(range.from, prefix?.to ?? range.from);
	if (visibleFrom >= range.to) return [];
	const visibleRange = EditorSelection.range(visibleFrom, range.to);
	const from = view.coordsAtPos(visibleRange.from, 1);
	const lastCharacter = view.coordsForChar(visibleRange.to - 1);
	if (!from || !lastCharacter) return [];
	if (Math.abs(from.top - lastCharacter.top) > 1 || view.bidiSpans(line).length > 1) {
		return RectangleMarker.forRange(view, 'cm-selectionBackground', visibleRange);
	}
	const scroll = view.scrollDOM;
	const scrollRect = scroll.getBoundingClientRect();
	const baseLeft = (view.textDirection === Direction.LTR
		? scrollRect.left
		: scrollRect.right - scroll.clientWidth * view.scaleX) - scroll.scrollLeft * view.scaleX;
	const baseTop = scrollRect.top - scroll.scrollTop * view.scaleY;
	const left = Math.min(from.left, lastCharacter.left);
	const right = Math.max(from.right, lastCharacter.right);
	return [new RectangleMarker(
		'cm-selectionBackground',
		left - baseLeft,
		Math.min(from.top, lastCharacter.top) - baseTop,
		right - left,
		Math.max(from.bottom, lastCharacter.bottom) - Math.min(from.top, lastCharacter.top),
	)];
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
		EditorView.editorAttributes.of((view) => ({
			class: ownsSelection(view, options) ? ACTIVE_CLASS : '',
		})),
		layer({
			above: false,
			class: 'paraflow-gap-selection-layer',
			markers(view): readonly LayerMarker[] {
				if (!ownsSelection(view, options)) return [];
				const gaps = structuralGaps(view.state);
				return selectionLineSegments(view.state, view.state.selection.ranges, gaps)
					.flatMap((range) => markersForLine(view, range));
			},
			update(update): boolean {
				return update.docChanged || update.selectionSet || update.viewportChanged ||
					update.geometryChanged || projectionChanged(update);
			},
		}),
	];
}
