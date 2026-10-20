import type { EditorSelection, EditorState } from '@codemirror/state';
import { buildSelectionScope } from './context-scopes.js';
import {
	sourceRange,
	ownedBodyStart,
	type AnalyzedItem,
	type SourceAnalysis,
	type SourceLine,
} from './context-analysis.js';
import type {
	ContextRuntime,
	ListPrefix,
	SelectionContext,
	SelectionSegment,
	SelectionSnapshot,
	SourceRange,
} from './model.js';
import { isSeparatorlessListMarkerLine } from './prefix.js';

export function selectionSnapshot(selection: EditorSelection): SelectionSnapshot {
	return {
		anchor: selection.main.anchor,
		empty: selection.main.empty,
		head: selection.main.head,
	};
}

export function selectionGate(
	state: EditorState,
	selection: EditorSelection,
	runtime: ContextRuntime,
): boolean {
	if (runtime.operation !== 'normal-selection' || runtime.selectionMode !== 'continuous') return false;
	if (runtime.selectionsCount !== 1 || selection.ranges.length !== 1 || selection.main.empty) return false;
	if (runtime.imeComposing) return false;
	return !(selection.main.from === 0 && selection.main.to === state.doc.length);
}

function itemForLine(analysis: SourceAnalysis, line: SourceLine): AnalyzedItem | null {
	if (isSeparatorlessListMarkerLine(analysis.source.slice({
		from: line.from,
		to: line.to,
	}))) return null;
	const marker = analysis.items.find((item) => item.line.from === line.from);
	if (marker) return marker;
	let owner: AnalyzedItem | null = null;
	for (const item of analysis.items) {
		if (item.block.item.from <= line.to && line.from < item.block.item.to) {
			if (!owner || item.depth > owner.depth) owner = item;
		}
	}
	return owner;
}

function selectedContentRange(
	line: SourceLine,
	source: SourceRange,
	owner: AnalyzedItem | null,
): SourceRange {
	const markerLine = owner?.line.from === line.from;
	const desiredStart = !owner
		? line.from
		: markerLine
			? owner.block.content.from
			: ownedBodyStart(line);
	const start = Math.min(Math.max(desiredStart, source.from), source.to);
	const visibleEnd = Math.min(source.to, line.to);
	return sourceRange(start, Math.max(start, visibleEnd));
}

function selectionSegments(
	analysis: SourceAnalysis,
	from: number,
	to: number,
): readonly SelectionSegment[] {
	const segments: SelectionSegment[] = [];
	for (const line of analysis.lines) {
		const source = sourceRange(Math.max(from, line.from), Math.min(to, line.newlineTo));
		if (source.to <= source.from) continue;
		const owner = line.codeLeaf ? null : itemForLine(analysis, line);
		const markerLine = owner?.line.from === line.from;
		segments.push({
			kind: owner ? 'list-content' : 'ordinary',
			prefix: markerLine ? selectionPrefix(owner.block.prefix, line) : null,
			selectedContent: selectedContentRange(line, source, owner),
			source,
		});
	}
	return segments;
}

function protectedSelectionRanges(
	analysis: SourceAnalysis,
	from: number,
	to: number,
): readonly SourceRange[] {
	return analysis.items
		.map((item) => item.block.prefix.full)
		.filter((prefix) => prefix.from < to && from < prefix.to)
		.map((prefix) => sourceRange(prefix.from, prefix.to));
}

function selectionPrefix(prefix: ListPrefix, line: SourceLine): ListPrefix {
	return prefix.indentText === line.indentText
		? prefix
		: { ...prefix, indentText: line.indentText };
}

export function buildSelectionFromAnalysis(
	analysis: SourceAnalysis,
	selection: EditorSelection,
	runtime: ContextRuntime,
): SelectionContext {
	const from = selection.main.from;
	const to = selection.main.to;
	const segments = selectionSegments(analysis, from, to);
	const protectedRanges = protectedSelectionRanges(analysis, from, to);
	return {
		editScope: buildSelectionScope(segments, runtime, analysis.source.length),
		protectedRanges,
		segments,
		selection: selectionSnapshot(selection),
		source: analysis.source,
	};
}
