import {
	EditorSelection,
	Prec,
	type EditorState,
	type Extension,
	type SelectionRange,
} from '@codemirror/state';
import {
	Decoration,
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
import { selectionPresentationSession } from '../runtime/selection-session.js';
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
		const label = view.dom.ownerDocument.createElement('label');
		label.className = 'task-list-label paraflow-selection-task-label';
		label.setAttribute('aria-hidden', 'true');
		label.setAttribute('contenteditable', 'false');
		const checkbox = view.dom.ownerDocument.createElement('input');
		checkbox.className = 'task-list-item-checkbox paraflow-selection-task-checkbox';
		checkbox.type = 'checkbox';
		checkbox.checked = this.checked;
		checkbox.tabIndex = -1;
		checkbox.setAttribute('aria-hidden', 'true');
		checkbox.setAttribute('contenteditable', 'false');
		label.append(checkbox);
		return label;
	}
}

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

function selectionExclusions(
	state: EditorState,
	structuralGaps: readonly SourceRange[],
	protectedPrefixes: readonly SourceRange[],
): readonly SourceRange[] {
	const editableAnchors = getParagraphProjectionState(state)?.rangeIndex.editableAnchors ?? [];
	const listGaps = getStructuredListSelectionTransparentRanges(state);
	const orderedListGaps = [...listGaps].sort((left, right) =>
		left.from - right.from || left.to - right.to);
	const editableBoundaries = orderedListGaps.flatMap((gap, index) => {
		const next = orderedListGaps[index + 1];
		if (!next || gap.to !== next.from) return [];
		const line = state.doc.lineAt(gap.to);
		if (line.from !== gap.to || line.length !== 0 || line.number === state.doc.lines) return [];
		return [{ from: gap.to, to: state.doc.line(line.number + 1).from }];
	});
	const anchorRanges = editableAnchors.map((anchor) => ({ from: anchor, to: anchor + 1 }));
	const normalizedGaps = structuralGaps.flatMap((gap) => {
		const isListGap = listGaps.some((candidate) =>
			candidate.from === gap.from && candidate.to === gap.to);
		const preservedRanges = [
			...anchorRanges,
			...(isListGap ? editableBoundaries : []),
		].sort((left, right) => left.from - right.from || left.to - right.to);
		const preserved = preservedRanges.filter((range) =>
			gap.from < range.to && range.from < gap.to);
		if (preserved.length === 0) return [gap];
		const ranges: SourceRange[] = [];
		let from = gap.from;
		for (const range of preserved) {
			const preservedFrom = Math.max(gap.from, range.from);
			const preservedTo = Math.min(gap.to, range.to);
			if (from < preservedFrom) ranges.push({ from, to: preservedFrom });
			from = Math.max(from, preservedTo);
		}
		if (from < gap.to) ranges.push({ from, to: gap.to });
		return ranges;
	});
	return mergeSourceRanges([
		...normalizedGaps,
		...protectedPrefixes.map((prefix) => markerOnlyPrefixRange(state, prefix)),
	]);
}

export function selectionSourceFragments(
	state: EditorState,
	ranges: readonly SelectionRange[],
	structuralGaps: readonly SourceRange[],
	protectedPrefixes: readonly SourceRange[],
): readonly SelectionRange[] {
	const exclusions = selectionExclusions(state, structuralGaps, protectedPrefixes);
	const fragments: SourceRange[] = [];
	for (const range of ranges) {
		if (range.empty) continue;
		let cursor = range.from;
		for (const exclusion of exclusions) {
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

function structuralGaps(state: EditorState): readonly SourceRange[] {
	return [
		...(getParagraphProjectionState(state)?.rangeIndex.gaps ?? []),
		...getStructuredListSelectionTransparentRanges(state),
	];
}

function selectionPresentationExclusions(state: EditorState): readonly SourceRange[] {
	return selectionExclusions(
		state,
		structuralGaps(state),
		getStructuredListProjectionState(state)?.rangeIndex.protectedRanges ?? [],
	);
}

function intersectsExclusion(range: SelectionRange, exclusion: SourceRange): boolean {
	return range.from < exclusion.to && exclusion.from < range.to;
}

function ownsSelection(view: EditorView, options: GapSelectionPresentationOptions): boolean {
	if (!options.isActive(view)) return false;
	if (!selectionPresentationSession(view.state).owned) return false;
	const exclusions = selectionPresentationExclusions(view.state);
	return view.state.selection.ranges.some((range) =>
		!range.empty && exclusions.some((candidate) => intersectsExclusion(range, candidate)));
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
				const fragments = selectionSourceFragments(
					view.state,
					view.state.selection.ranges,
					structuralGaps(view.state),
					getStructuredListProjectionState(view.state)?.rangeIndex.protectedRanges ?? [],
				);
				return fragments.flatMap((fragment) =>
					RectangleMarker.forRange(view, 'cm-selectionBackground', fragment));
			},
			update(update): boolean {
				return update.docChanged || update.selectionSet || update.viewportChanged ||
					update.geometryChanged || projectionChanged(update);
			},
		}),
		Prec.highest(taskCheckboxProjection),
	];
}
