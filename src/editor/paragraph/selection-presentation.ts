import {
	EditorSelection,
	StateEffect,
	type EditorState,
	type Extension,
	type SelectionRange,
} from '@codemirror/state';
import {
	Direction,
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
import { classifyCurrentSelectionMode } from '../runtime/input-state.js';
import { mathPreviewReplacementOwner } from '../math/preview-owner.js';

const ACTIVE_CLASS = 'paraflow-gap-selection-presentation-active';
const LIST_RANGE_HEAD_CLASS = 'paraflow-list-range-head-hidden';
const codeSelectionScrolled = StateEffect.define<null>();

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

function overlapsSourceRange(ranges: readonly SourceRange[], from: number, to: number): boolean {
	let low = 0, high = ranges.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (ranges[middle]!.to <= from) low = middle + 1; else high = middle;
	}
	return low < ranges.length && ranges[low]!.from < to;
}

function mathWidgetMarkers(view: EditorView, exclusions: readonly SourceRange[]): RectangleMarker[] {
	const selected = selectionFragmentsFromExclusions(intersectRanges(view.state.selection.ranges, [view.viewport]), exclusions);
	if (!selected.length) return [];
	const scroll = view.scrollDOM.getBoundingClientRect();
	// Match RectangleMarker's coordinate base, including RTL scrolling and CSS scaling.
	const left = (view.textDirection === Direction.LTR ? scroll.left : scroll.right - view.scrollDOM.clientWidth * view.scaleX)
		- view.scrollDOM.scrollLeft * view.scaleX;
	const top = scroll.top - view.scrollDOM.scrollTop * view.scaleY;
	const markers: RectangleMarker[] = [];
	for (const widget of view.contentDOM.querySelectorAll<HTMLElement>('.paraflow-math-rendered:is(.math-inline, .paraflow-math-block-preview)')) {
		const block = widget.classList.contains('paraflow-math-block-preview');
		const owner = mathPreviewReplacementOwner(widget);
		if (block && !owner) continue;
		// Widget-internal offsets may all map to its start; parent boundaries span the replacement.
		const parent = widget.parentNode!, index = Array.prototype.indexOf.call(parent.childNodes, widget);
		const from = owner?.from ?? view.posAtDOM(parent, index), to = owner?.to ?? view.posAtDOM(parent, index + 1);
		if (to <= view.viewport.from || from >= view.viewport.to ||
			!overlapsSourceRange(selected, from, to) ||
			(!block && (overlapsSourceRange(exclusions, from, to) ||
			view.visibleRanges.some(range => range.from <= from && to <= range.to)))) continue;
		// Line-local CM ranges cannot paint block replacements; long inline ones are clipped.
		// Display containers span the editor width; only the owned SVG is formula content.
		const content = block ? widget.querySelector(':scope > mjx-container.paraflow-svg-math > svg') : widget;
		if (!content) continue; // Async loading/error previews have no rendered formula yet.
		for (const rect of content.getClientRects()) if (rect.width > 0 && rect.height > 0) {
			markers.push(new RectangleMarker('cm-selectionBackground', rect.left - left, rect.top - top, rect.width, rect.height));
		}
	}
	return markers;
}

function textSelectionMarkers(view: EditorView, fragment: SelectionRange): readonly RectangleMarker[] {
	const start = view.domAtPos(fragment.from), end = view.domAtPos(fragment.to);
	const element = start.node.nodeType === Node.ELEMENT_NODE ? start.node as Element : start.node.parentElement;
	const line = element?.closest('.cm-line');
	const code = line?.classList.contains('paraflow-code-line');
	const markers = code ? [] : RectangleMarker.forRange(view, 'cm-selectionBackground', fragment);
	if (!code && (markers.length < 2 || markers.every(marker =>
		marker.top === markers[0]!.top && marker.height === markers[0]!.height))) return markers;
	if (!line || !code && !(line.classList.contains('paraflow-list-owned-line') ||
		line.querySelector('.paraflow-list-marker, .paraflow-task-prefix'))) return markers;

	// CM's editor-wide wrapped fill cannot express local code/list geometry.
	// Measure the already prefix-excluded text rows instead.
	const range = view.dom.ownerDocument.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	const scroll = view.scrollDOM.getBoundingClientRect();
	const left = (view.textDirection === Direction.LTR ? scroll.left : scroll.right - view.scrollDOM.clientWidth * view.scaleX)
		- view.scrollDOM.scrollLeft * view.scaleX;
	const top = scroll.top - view.scrollDOM.scrollTop * view.scaleY;
	let clipLeft = -Infinity, clipRight = Infinity;
	if (code) {
		// The external selection layer does not inherit the row's overflow clip.
		// Padding owns container insets; wrapped rows already include their gutter.
		const style = view.dom.ownerDocument.defaultView!.getComputedStyle(line);
		const rect = line.getBoundingClientRect();
		clipLeft = rect.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * view.scaleX;
		clipRight = rect.right - (parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight)) * view.scaleX;
		if (line.hasAttribute('data-paraflow-line') && !line.classList.contains('paraflow-code-wrap') &&
			!line.classList.contains('paraflow-code-virtual')) {
			const gutter = view.dom.ownerDocument.defaultView!.getComputedStyle(line, '::before');
			clipLeft += (parseFloat(gutter.width) + parseFloat(gutter.marginRight)) * view.scaleX;
		}
	}
	return Array.from(range.getClientRects()).flatMap(rect => {
		const from = Math.max(rect.left, clipLeft), to = Math.min(rect.right, clipRight);
		return to > from && rect.height > 0
			? [new RectangleMarker('cm-selectionBackground', from - left, rect.top - top, to - from, rect.height)] : [];
	});
}

/** Union the approved vertical expansion so each pixel receives selection alpha only once. */
function expandedSelectionMarkers(markers: readonly RectangleMarker[]): RectangleMarker[] {
	const edges = markers.flatMap((marker, index) => marker.width! > 0 && marker.height > 0
		? [{ y: marker.top - 2, index, start: true }, { y: marker.top + marker.height + 2, index, start: false }] : [])
		.sort((left, right) => left.y - right.y);
	const active = new Set<number>();
	const result: RectangleMarker[] = [];
	let previous = new Map<string, number>();
	for (let index = 0; index < edges.length;) {
		const top = edges[index]!.y;
		while (index < edges.length && edges[index]!.y === top) {
			const edge = edges[index++]!;
			if (edge.start) active.add(edge.index); else active.delete(edge.index);
		}
		if (index === edges.length) break;
		const bottom = edges[index]!.y;
		const spans = [...active].map(item => markers[item]!).sort((left, right) => left.left - right.left);
		const merged: { left: number; right: number }[] = [];
		for (const span of spans) {
			const last = merged.at(-1), right = span.left + span.width!;
			if (last && span.left <= last.right) last.right = Math.max(last.right, right);
			else merged.push({ left: span.left, right });
		}
		const current = new Map<string, number>();
		for (const span of merged) {
			const key = `${span.left}:${span.right}`, prior = previous.get(key);
			const row = prior === undefined ? result.length : prior;
			const start = prior === undefined ? top : result[prior]!.top;
			result[row] = new RectangleMarker('cm-selectionBackground', span.left, start, span.right - span.left, bottom - start);
			current.set(key, row);
		}
		previous = current;
	}
	return result;
}

export function createGapSelectionPresentation(
	options: GapSelectionPresentationOptions,
): Extension {
	const mountedViews = new WeakSet<EditorView>();
	return [
		selectionExclusionSnapshotPlugin,
		ViewPlugin.define(view => {
			let mounted = true, pending = false;
			const scroll = (event: Event) => {
				const target = event.target as Element;
				if (pending || !target.classList.contains('paraflow-code-line') ||
					!presentsSelection(view, options) || view.state.selection.ranges.every(range => range.empty)) return;
				pending = true;
				// One block scrolls several rows. Notify the layer once, without editing history.
				queueMicrotask(() => {
					pending = false;
					if (mounted) view.dispatch({ effects: codeSelectionScrolled.of(null) });
				});
			};
			view.contentDOM.addEventListener('scroll', scroll, true);
			return { destroy() { mounted = false; view.contentDOM.removeEventListener('scroll', scroll, true); } };
		}),
		EditorView.editorAttributes.of(view => {
			if (!presentsSelection(view, options)) return { class: '' };
			const { state } = view;
			const range = state.selection.main;
			const hidden = state.selection.ranges.length === 1 && !range.empty &&
				classifyCurrentSelectionMode(state) === 'continuous' &&
				getStructuredListProjectionState(state)?.rangeIndex.protectedRanges.some(prefix =>
					prefix.from <= range.head && range.head < prefix.to);
			return { class: ACTIVE_CLASS + (hidden ? ` ${LIST_RANGE_HEAD_CLASS}` : '') };
		}),
		EditorView.baseTheme({
			'.paraflow-gap-selection-layer, .paraflow-gap-selection-layer .cm-selectionBackground': { pointerEvents: 'none' },
			[`&.${LIST_RANGE_HEAD_CLASS} .cm-cursor-primary`]: { visibility: 'hidden !important' },
			[`&.${LIST_RANGE_HEAD_CLASS} .cm-content`]: { caretColor: 'transparent !important' },
		}),
		layer({
			above: true,
			class: 'paraflow-gap-selection-layer',
			mount(_element, view) { mountedViews.add(view); },
			destroy(_element, view) { mountedViews.delete(view); },
			markers(view): readonly LayerMarker[] {
				// CodeMirror may run an already queued layer measure after unmount.
				if (!mountedViews.has(view)) return [];
				if (!presentsSelection(view, options)) return [];
				const exclusions = selectionPresentationExclusionsForView(view);
				const paintRanges = selectionPaintRangesInVisibleRanges(
					view.state,
					view.state.selection.ranges,
					view.visibleRanges,
					exclusions,
				);
				return expandedSelectionMarkers([
					...paintRanges.flatMap(fragment => textSelectionMarkers(view, fragment)),
					...mathWidgetMarkers(view, exclusions),
				]);
			},
			update(update): boolean {
				return update.docChanged || update.selectionSet || update.viewportChanged ||
					update.geometryChanged || projectionChanged(update) ||
					update.transactions.some(transaction => transaction.effects.some(effect => effect.is(codeSelectionScrolled)));
			},
		}),
	];
}
