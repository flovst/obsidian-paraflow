import {
	createEditScope,
	type ContextEditRegion,
	type EditRegionKind,
	type EditScope,
} from './edit-plan.js';
import type { SourceAnalysis } from './context-analysis.js';
import { containingLine, sourceRange } from './context-analysis.js';
import type {
	ContextRuntime,
	FollowingBoundary,
	ListBlockRef,
	ListContext,
	ListTopology,
	SelectionSegment,
	SourceRange,
} from './model.js';
import type { HandledOperationId } from './operations.js';
import { markdownColumns } from './prefix.js';
import { indentBoundaryChanges } from './indent-boundaries.js';

function region(
	kind: EditRegionKind,
	index: number | null,
	range: SourceRange,
	protection: ContextEditRegion['protection'] = 'ordinary',
): ContextEditRegion {
	return { id: { index, kind }, protection, range: sourceRange(range.from, range.to) };
}

function orderedRegions(
	current: ListBlockRef,
	topology: ListTopology,
): readonly ContextEditRegion[] {
	return sequenceRegions(current, topology.orderedSequence, 'ordered-sequence-item');
}

function sequenceRegions(
	current: ListBlockRef,
	sequence: ListTopology['orderedSequence'],
	kind: 'ordered-sequence-item' | 'parent-ordered-sequence-item',
): readonly ContextEditRegion[] {
	return sequence?.items.flatMap((item, index) =>
		item.item.from === current.item.from
			? []
			: [region(kind, index, item.prefix.full, 'protected-prefix')]) ?? [];
}

function whitespaceRegions(topology: ListTopology): readonly ContextEditRegion[] {
	return topology.whitespaceBoundaries.map((fact, index) =>
		region('whitespace-boundary', index, fact.range));
}

function ownedRegions(topology: ListTopology): readonly ContextEditRegion[] {
	return topology.ownedBlocks.map((block, index) => region(
		'owned-block',
		index,
		block.range,
		'protected-prefix',
	));
}

function outsideCurrentItem(current: ListBlockRef, range: SourceRange): boolean {
	return range.to <= current.item.from || range.from >= current.item.to;
}

function outsideItemWhitespace(
	current: ListBlockRef,
	topology: ListTopology,
): readonly ContextEditRegion[] {
	return whitespaceRegions(topology).filter((candidate) => outsideCurrentItem(current, candidate.range));
}

function granularLayout(
	current: ListBlockRef,
	topology: ListTopology,
	includePrefix: boolean,
): readonly ContextEditRegion[] {
	return [
		...orderedRegions(current, topology),
		...whitespaceRegions(topology),
		...(includePrefix ? [region('current-prefix', null, current.prefix.full, 'protected-prefix')] : []),
		region('current-content', null, current.content),
		...ownedRegions(topology),
	];
}

function emptyItemLayout(
	current: ListBlockRef,
	topology: ListTopology,
): readonly ContextEditRegion[] {
	return [
		...orderedRegions(current, topology),
		...outsideItemWhitespace(current, topology),
		region('current-item', null, current.item, 'protected-prefix'),
	];
}

function emptyBackspaceLayout(
	current: ListBlockRef,
	topology: ListTopology,
): readonly ContextEditRegion[] {
	return [
		...orderedRegions(current, topology),
		...outsideItemWhitespace(current, topology),
		region(
			'current-item',
			null,
			sourceRange(current.lineFrom, current.item.to),
			'protected-prefix',
		),
	];
}

function markerLineLayout(
	current: ListBlockRef,
	topology: ListTopology,
	includeParentOrdered = false,
): readonly ContextEditRegion[] {
	return [
		...orderedRegions(current, topology),
		...(includeParentOrdered ? sequenceRegions(
			current,
			topology.parentOrderedSequence,
			'parent-ordered-sequence-item',
		) : []),
		...whitespaceRegions(topology),
		region(
			'current-item',
			null,
			sourceRange(current.lineFrom, current.markerLine.to),
			'protected-prefix',
		),
		...ownedRegions(topology),
	];
}

function previousRelationshipRegions(topology: ListTopology): readonly ContextEditRegion[] {
	const regions: ContextEditRegion[] = [];
	if (topology.previousSibling) {
		regions.push(region('previous-sibling', 0, topology.previousSibling.prefix.full, 'protected-prefix'));
	}
	if (topology.precedingContainer) {
		regions.push(region('preceding-container', 0, topology.precedingContainer.content));
	}
	return regions;
}

function boundaryBackspaceLayout(
	current: ListBlockRef,
	topology: ListTopology,
): readonly ContextEditRegion[] {
	const next = topology.nextSibling
		? [region('next-sibling', 0, topology.nextSibling.markerLine, 'protected-prefix')]
		: [];
	return [
		...previousRelationshipRegions(topology),
		...whitespaceRegions(topology),
		region(
			'current-item',
			null,
			sourceRange(current.lineFrom, current.markerLine.to),
			'protected-prefix',
		),
		...ownedRegions(topology),
		...next,
	];
}

function followingRange(following: FollowingBoundary): SourceRange | null {
	if (following.kind === 'list-item') return following.block.content;
	if ('range' in following) return following.range;
	return null;
}

function contentDeleteLayout(
	current: ListBlockRef,
	topology: ListTopology,
): readonly ContextEditRegion[] {
	const regions: ContextEditRegion[] = [
		region('current-content', null, current.content),
	];
	const boundary = topology.followingStructuralBoundary;
	if (topology.followingBoundary.kind === 'terminal-newlines' && boundary) {
		regions.push(region('terminal-newlines', 0, boundary.removalRange));
		return regions;
	}
	if (boundary) {
		const index = topology.structuralBoundaries.indexOf(boundary);
		regions.push(region('structural-boundary', index, boundary.removalRange, 'protected-prefix'));
	}
	const following = followingRange(topology.followingBoundary);
	if (following) regions.push(region('following-block', 0, following));
	return regions;
}

function ownedContentDeleteLayout(current: ListBlockRef, topology: ListTopology,
	caretContent: ListContext['caretContent']): readonly ContextEditRegion[] {
	const regions = [...contentDeleteLayout(current, topology)];
	for (const [index, boundary] of topology.structuralBoundaries.entries()) {
		if (boundary.whitespace.fromAnchor !== `owned-block:${caretContent.ownedBlockIndex}` ||
			boundary.removalRange.from !== caretContent.range.to) continue;
		regions.push(region(boundary.following.kind === 'terminal-newlines' ? 'terminal-newlines' : 'structural-boundary',
			index, boundary.removalRange, 'protected-prefix'));
	}
	return regions;
}

function sortRegions(regions: readonly ContextEditRegion[]): readonly ContextEditRegion[] {
	return [...regions].sort((left, right) => {
		const start = left.range.from - right.range.from;
		if (start !== 0) return start;
		const end = left.range.to - right.range.to;
		return end !== 0 ? end : left.id.kind.localeCompare(right.id.kind);
	});
}

const boundaryBackspaceOperations = new Set<HandledOperationId>([
	'backspace-empty-nested',
	'backspace-empty-top-level',
	'backspace-nested-content-start',
	'backspace-top-level-content-start',
]);

const nonEmptyEnterOperations = new Set<HandledOperationId>([
	'enter-non-empty',
	'enter-task-non-empty',
	'shift-enter',
]);

const emptyEnterOperations = new Set<HandledOperationId>([
	'enter-empty-nested',
	'enter-empty-top-level',
]);

function backspaceLayout(
	current: ListBlockRef,
	topology: ListTopology,
): readonly ContextEditRegion[] {
	if (current.content.from === current.content.to) return emptyBackspaceLayout(current, topology);
	return boundaryBackspaceLayout(current, topology);
}

function tabMovesMarker(current: ListBlockRef, topology: ListTopology): boolean {
	const previous = topology.indentParent;
	if (!previous) return false;
	const target = markdownColumns(previous.prefix.indentText + previous.prefix.markerText + previous.prefix.separatorText);
	return target !== markdownColumns(current.prefix.indentText);
}

function structuralLayout(
	operation: HandledOperationId,
	current: ListBlockRef,
	topology: ListTopology,
): readonly ContextEditRegion[] {
	if (nonEmptyEnterOperations.has(operation)) return granularLayout(current, topology, true);
	if (emptyEnterOperations.has(operation)) return emptyItemLayout(current, topology);
	if (operation === 'tab') {
		return tabMovesMarker(current, topology)
			? markerLineLayout(current, topology)
			: granularLayout(current, topology, false);
	}
	if (operation === 'shift-tab') return markerLineLayout(current, topology, true);
	if (boundaryBackspaceOperations.has(operation)) return backspaceLayout(current, topology);
	if (operation === 'backspace-delete-inside-content') return contentDeleteLayout(current, topology);
	return [];
}

export function terminalInsertionLine(
	analysis: SourceAnalysis,
	position: number,
	runtime: ContextRuntime,
): SourceRange | null {
	if (runtime.operation !== 'up-down' || runtime.editIntent !== 'conditional-terminal') return null;
	const line = containingLine(analysis.lines, position);
	const finalLine = analysis.lines.at(-1);
	if (line !== finalLine || line.to !== analysis.source.length || line.whitespaceKind !== null) return null;
	return sourceRange(analysis.source.length, analysis.source.length);
}

function emptyBodyEnterLayout(operation: HandledOperationId, current: ListBlockRef,
	topology: ListTopology, caretContent: ListContext['caretContent']): readonly ContextEditRegion[] | null {
	if (operation !== 'enter-non-empty' && operation !== 'enter-task-non-empty') return null;
	if (caretContent.range.from !== caretContent.range.to) return null;
	return [region('current-content', null, caretContent.range), ...orderedRegions(current, topology),
		...whitespaceRegions(topology).map(region => ({ ...region, protection: 'protected-prefix' as const })),
		region('owned-block', caretContent.ownedBlockIndex, topology.ownedBlocks[caretContent.ownedBlockIndex!]!.range, 'protected-prefix')];
}

function ownedBodyContentLayout(operation: HandledOperationId, current: ListBlockRef,
	topology: ListTopology, caretContent: ListContext['caretContent'], position: number): readonly ContextEditRegion[] | null {
	if (operation === 'tab') return ownedBodyTabLayout(current, topology, caretContent);
	if (operation === 'backspace-delete-inside-content') return ownedContentDeleteLayout(current, topology, caretContent);
	if (ownedContinuationEnter(operation, caretContent.kind)) {
		const content = position === caretContent.range.from
			? region('owned-block', caretContent.ownedBlockIndex, topology.ownedBlocks[caretContent.ownedBlockIndex!]!.range, 'protected-prefix')
			: region('current-content', null, caretContent.range);
		return [content, ...orderedRegions(current, topology)];
	}
	if (nonEmptyEnterOperations.has(operation) || emptyEnterOperations.has(operation)) {
		return [region('current-content', null, caretContent.range)];
	}
	return null;
}

function ownedBodyTabLayout(current: ListBlockRef, topology: ListTopology,
	caretContent: ListContext['caretContent']): readonly ContextEditRegion[] {
	if (caretContent.kind === 'continuation' && tabMovesMarker(current, topology)) return markerLineLayout(current, topology);
	if (caretContent.paragraphIndentParent) return [
		...whitespaceRegions(topology).map(boundary => ({ ...boundary, protection: 'protected-prefix' as const })),
		...caretContent.subtreeBlockIndexes.map(index =>
			region('owned-block', index, topology.ownedBlocks[index]!.range, 'protected-prefix')),
	];
	return [region('current-content', null, caretContent.range)];
}

function ownedContinuationEnter(operation: HandledOperationId, kind: ListContext['caretContent']['kind']): boolean {
	return kind === 'continuation' && (operation === 'enter-non-empty' || operation === 'enter-task-non-empty');
}

function structuralLayoutAtCaret(
	operation: HandledOperationId,
	current: ListBlockRef,
	topology: ListTopology,
	caretContent: ListContext['caretContent'],
	position: number,
): readonly ContextEditRegion[] {
	if (caretContent.kind !== 'marker-line') {
		if (boundaryBackspaceOperations.has(operation)) return [];
		const emptyBody = emptyBodyEnterLayout(operation, current, topology, caretContent);
		if (emptyBody) return emptyBody;
		const content = ownedBodyContentLayout(operation, current, topology, caretContent, position);
		if (content) return content;
		if (operation === 'shift-tab') return caretContent.subtreeBlockIndexes.map(index =>
			region('owned-block', index, topology.ownedBlocks[index]!.range, 'protected-prefix'));
	}
	return structuralLayout(operation, current, topology);
}

export function buildListScope(
	analysis: SourceAnalysis,
	current: ListBlockRef,
	topology: ListTopology,
	position: number,
	runtime: ContextRuntime,
	caretContent: ListContext['caretContent'],
): EditScope {
	const line = containingLine(analysis.lines, position);
	const emptyMarkerLine = line.from === current.lineFrom && current.content.from === current.content.to;
	const terminal = emptyMarkerLine ? null : terminalInsertionLine(analysis, position, runtime);
	if (terminal) {
		return createEditScope(runtime.operation, 'editable', [
			region('terminal-insertion', 0, terminal),
		], analysis.source.length);
	}
	if (runtime.editIntent === 'none' || runtime.editIntent === 'conditional-terminal') {
		return createEditScope(runtime.operation, 'selection-only', [], analysis.source.length);
	}
	const layout = structuralLayoutAtCaret(runtime.operation, current, topology, caretContent, position);
	const joins = runtime.operation === 'tab' && caretContent.kind !== 'additional-paragraph'
		? indentBoundaryChanges(analysis.source, current, topology) : [];
	const regions = sortRegions([...layout, ...joins.map((change, index) =>
		region('whitespace-boundary', topology.whitespaceBoundaries.length + index, change))]);
	return createEditScope(runtime.operation, 'editable', regions, analysis.source.length);
}

export function buildOrdinaryScope(
	analysis: SourceAnalysis,
	position: number,
	runtime: ContextRuntime,
): EditScope {
	const terminal = terminalInsertionLine(analysis, position, runtime);
	return terminal
		? createEditScope(runtime.operation, 'editable', [region('terminal-insertion', 0, terminal)], analysis.source.length)
		: createEditScope(runtime.operation, 'selection-only', [], analysis.source.length);
}

function selectionContentKind(index: number, count: number): EditRegionKind {
	if (index === 0) return 'selection-start-content';
	return index === count - 1 ? 'selection-end-content' : 'selection-intervening-item';
}

function segmentBoundary(segment: SelectionSegment): SourceRange | null {
	const from = segment.selectedContent.to;
	return from < segment.source.to ? sourceRange(from, segment.source.to) : null;
}

function coversCompletePhysicalPrefix(segment: SelectionSegment, index: number): boolean {
	return index > 0 &&
		segment.prefix !== null &&
		segment.source.from <= segment.prefix.full.from &&
		segment.prefix.full.to <= segment.source.to;
}

function selectionRegions(segments: readonly SelectionSegment[]): readonly ContextEditRegion[] {
	const regions: ContextEditRegion[] = [];
	segments.forEach((segment, index) => {
		if (coversCompletePhysicalPrefix(segment, index)) {
			regions.push(region(
				selectionContentKind(index, segments.length),
				index,
				segment.source,
				'protected-prefix',
			));
			return;
		}
		regions.push(region(selectionContentKind(index, segments.length), index, segment.selectedContent));
		const boundary = segmentBoundary(segment);
		if (boundary) regions.push(region('whitespace-boundary', index, boundary));
	});
	return sortRegions(regions);
}

export function buildSelectionScope(
	segments: readonly SelectionSegment[],
	runtime: ContextRuntime,
	sourceLength: number,
): EditScope {
	return runtime.editIntent === 'cut'
		? createEditScope(runtime.operation, 'editable', selectionRegions(segments), sourceLength)
		: createEditScope(runtime.operation, 'selection-only', [], sourceLength);
}

export function buildSelectionIndentScope(
	operation: 'tab' | 'shift-tab',
	ranges: readonly SourceRange[],
	sourceLength: number,
): EditScope {
	return createEditScope(operation, 'editable', ranges.map((range, index) =>
		region('owned-block', index, range, 'protected-prefix')), sourceLength);
}
