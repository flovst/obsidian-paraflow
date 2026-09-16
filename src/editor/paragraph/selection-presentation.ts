import {
	EditorSelection,
	Prec,
	type EditorState,
	type Extension,
	type SelectionRange,
} from '@codemirror/state';
import {
	Decoration,
	Direction,
	EditorView,
	layer,
	RectangleMarker,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type LayerMarker,
	type ViewUpdate,
} from '@codemirror/view';
import {
	getStructuredListProjectionState,
	getStructuredListSelectionTransparentRanges,
	getStructuredListTaskTokens,
} from '../structured-list/projection.js';
import type { SourceRange } from '../structured-list/model.js';
import { classifyCurrentSelectionMode } from '../runtime/input-state.js';
import { getParagraphProjectionState } from './projection.js';

const ACTIVE_CLASS = 'paraflow-gap-selection-presentation-active';

class SelectionTaskCheckboxWidget extends WidgetType {
	constructor(readonly checked: boolean) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof SelectionTaskCheckboxWidget && other.checked === this.checked;
	}

	ignoreEvent(): boolean {
		return true;
	}

	toDOM(view: EditorView): HTMLElement {
		const checkbox = view.dom.ownerDocument.createElement('input');
		checkbox.className = 'task-list-item-checkbox paraflow-selection-task-checkbox';
		checkbox.type = 'checkbox';
		checkbox.checked = this.checked;
		checkbox.tabIndex = -1;
		checkbox.setAttribute('aria-hidden', 'true');
		checkbox.setAttribute('contenteditable', 'false');
		return checkbox;
	}
}

export interface GapSelectionPresentationOptions {
	readonly isActive: (view: EditorView) => boolean;
}

interface SelectionCoordinates {
	readonly bottom: number;
	readonly left: number;
	readonly right: number;
	readonly top: number;
}

export function singleLineSelectionRectangle(
	startCoordinates: SelectionCoordinates,
	firstCharacter: SelectionCoordinates,
	lastCharacter: SelectionCoordinates,
): SelectionCoordinates {
	return {
		bottom: Math.max(startCoordinates.bottom, lastCharacter.bottom),
		left: Math.min(firstCharacter.left, lastCharacter.left),
		right: Math.max(firstCharacter.right, lastCharacter.right),
		top: Math.min(startCoordinates.top, lastCharacter.top),
	};
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
	const firstCharacter = view.coordsForChar(visibleRange.from);
	const lastCharacter = view.coordsForChar(visibleRange.to - 1);
	if (!from || !lastCharacter) return [];
	if (!firstCharacter) {
		return RectangleMarker.forRange(view, 'cm-selectionBackground', visibleRange);
	}
	if (Math.abs(from.top - lastCharacter.top) > 1 || view.bidiSpans(line).length > 1) {
		return RectangleMarker.forRange(view, 'cm-selectionBackground', visibleRange);
	}
	const scroll = view.scrollDOM;
	const scrollRect = scroll.getBoundingClientRect();
	const baseLeft = (view.textDirection === Direction.LTR
		? scrollRect.left
		: scrollRect.right - scroll.clientWidth * view.scaleX) - scroll.scrollLeft * view.scaleX;
	const baseTop = scrollRect.top - scroll.scrollTop * view.scaleY;
	const rectangle = singleLineSelectionRectangle(from, firstCharacter, lastCharacter);
	return [new RectangleMarker(
		'cm-selectionBackground',
		rectangle.left - baseLeft,
		rectangle.top - baseTop,
		rectangle.right - rectangle.left,
		rectangle.bottom - rectangle.top,
	)];
}

function projectionChanged(update: ViewUpdate): boolean {
	return getParagraphProjectionState(update.startState) !==
		getParagraphProjectionState(update.state) ||
		getStructuredListProjectionState(update.startState) !==
		getStructuredListProjectionState(update.state);
}

function selectedTaskDecorations(
	view: EditorView,
	options: GapSelectionPresentationOptions,
): DecorationSet {
	if (!options.isActive(view)) return Decoration.none;
	if (classifyCurrentSelectionMode(view.state) !== 'continuous') return Decoration.none;
	const ranges = view.state.selection.ranges.filter(({ empty }) => !empty);
	if (ranges.length === 0) return Decoration.none;
	return Decoration.set(getStructuredListTaskTokens(view.state)
		.filter((token) => ranges.some((range) =>
			range.from < token.to && token.from < range.to))
		.map((token) => Decoration.replace({
			widget: new SelectionTaskCheckboxWidget(token.checked),
		}).range(token.from, token.to)), true);
}

export function createGapSelectionPresentation(
	options: GapSelectionPresentationOptions,
): Extension {
	const taskCheckboxProjection = ViewPlugin.fromClass(class {
		decorations: DecorationSet;

		constructor(readonly view: EditorView) {
			this.decorations = selectedTaskDecorations(view, options);
		}

		update(update: ViewUpdate): void {
			if (!update.selectionSet && !update.docChanged && !projectionChanged(update)) return;
			this.decorations = selectedTaskDecorations(this.view, options);
		}
	}, {
		decorations: (value) => value.decorations,
	});
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
		Prec.highest(taskCheckboxProjection),
	];
}
