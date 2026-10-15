import {
	containingLine,
	isOnlyBoundaryWhitespace,
	isEditableOwnedWhitespace,
	sourceRange,
	type AnalyzedItem,
	type SourceAnalysis,
	type SourceLine,
} from './context-analysis.js';
import { hasListGroupBoundary } from './group-boundary.js';
import {
	buildNormalizedBoundaries,
	buildWhitespaceFacts,
	sameFollowingBoundary,
	type AnchorPoint,
} from './context-boundaries.js';
import type {
	FollowingBoundary,
	ListBlockRef,
	ListTopology,
	NormalizedStructuralBoundary,
	OrderedSequenceContext,
	OwnedBlock,
	ProjectionListContext,
	ProjectionOwnedLine,
	SourceRange,
} from './model.js';

interface ItemRelations {
	readonly siblings: readonly AnalyzedItem[];
	readonly siblingIndex: number;
	readonly previousSibling: AnalyzedItem | null;
	readonly nextSibling: AnalyzedItem | null;
	readonly parent: AnalyzedItem | null;
}

const itemFamily = (item: AnalyzedItem): 'ordered' | 'bullet' =>
	item.block.prefix.orderedValue === null ? 'bullet' : 'ordered';

function siblingsAreAdjacent(
	analysis: SourceAnalysis,
	left: AnalyzedItem | undefined,
	right: AnalyzedItem | undefined,
): boolean {
	if (!left || !right || itemFamily(left) !== itemFamily(right)) return false;
	const between = analysis.source.text.slice(left.block.item.to, right.line.from);
	return isOnlyBoundaryWhitespace(between) && !hasListGroupBoundary(analysis.source.text,
		left.block.item.to, right.line.from);
}

function directSiblingRun(
	analysis: SourceAnalysis,
	item: AnalyzedItem,
): readonly AnalyzedItem[] {
	const candidates = analysis.items.filter((candidate) => candidate.parentIndex === item.parentIndex);
	const currentIndex = candidates.indexOf(item);
	if (currentIndex < 0) return [item];
	let start = currentIndex;
	let end = currentIndex;
	while (start > 0 && siblingsAreAdjacent(analysis, candidates[start - 1], candidates[start])) start -= 1;
	while (end + 1 < candidates.length && siblingsAreAdjacent(analysis, candidates[end], candidates[end + 1])) end += 1;
	return candidates.slice(start, end + 1);
}

function orderedSequence(
	item: AnalyzedItem,
	siblings: readonly AnalyzedItem[],
): OrderedSequenceContext | null {
	if (item.block.prefix.orderedValue === null) return null;
	const ordered = siblings.filter((candidate) => candidate.block.prefix.orderedValue !== null);
	const currentIndex = ordered.indexOf(item);
	const firstValue = ordered[0]?.block.prefix.orderedValue;
	if (currentIndex < 0 || firstValue === null || firstValue === undefined) return null;
	return {
		currentIndex,
		items: ordered.map((candidate) => candidate.block),
		renderedValue: firstValue + currentIndex,
	};
}

function isDescendantOf(
	analysis: SourceAnalysis,
	candidate: AnalyzedItem,
	ancestor: AnalyzedItem,
): boolean {
	let parent = candidate.parentIndex;
	while (parent !== null) {
		const parentItem = analysis.items[parent];
		if (parentItem === ancestor) return true;
		parent = parentItem?.parentIndex ?? null;
	}
	return false;
}

function deepestOwner(
	analysis: SourceAnalysis,
	item: AnalyzedItem,
	line: SourceLine,
): AnalyzedItem {
	let owner = item;
	for (const candidate of analysis.items) {
		const insideLine = candidate.block.item.from <= line.to && line.from < candidate.block.item.to;
		const descendant = candidate.depth > item.depth && isDescendantOf(analysis, candidate, item);
		if (insideLine && descendant && candidate.depth > owner.depth) owner = candidate;
	}
	return owner;
}

function ownedBlockKind(line: SourceLine, descendant: boolean, paragraphBroken: boolean): OwnedBlock['kind'] {
	if (line.codeLeaf) return 'code-leaf';
	if (descendant) return 'descendant';
	return paragraphBroken ? 'additional-paragraph' : 'continuation';
}

function ownedBlocks(analysis: SourceAnalysis, item: AnalyzedItem): readonly OwnedBlock[] {
	const owned: OwnedBlock[] = [];
	let paragraphBroken = false;
	for (const line of analysis.lines) {
		if (line.from <= item.line.from || line.from >= item.block.item.to) continue;
		const owner = deepestOwner(analysis, item, line);
		if (line.whitespaceKind !== null && !isEditableOwnedWhitespace(analysis, owner, line)) {
			paragraphBroken = true;
			continue;
		}
		const descendant = owner !== item;
		owned.push({
			indentText: line.indentText,
			kind: ownedBlockKind(line, descendant, paragraphBroken),
			range: sourceRange(line.from, line.to),
			relativeDepth: descendant ? owner.depth - item.depth : 0,
		});
	}
	return owned;
}

function followingForOwned(
	analysis: SourceAnalysis,
	item: AnalyzedItem,
	owned: OwnedBlock,
): FollowingBoundary {
	if (owned.kind === 'code-leaf') return { kind: 'unsupported' };
	if (owned.kind === 'descendant') {
		const descendant = analysis.items.find((candidate) =>
			candidate.depth > item.depth && candidate.line.from === owned.range.from);
		if (descendant) return { block: descendant.block, kind: 'list-item' };
	}
	const line = containingLine(analysis.lines, owned.range.from);
	const content = sourceRange(line.from + line.indentText.length, line.to);
	return { kind: owned.kind === 'additional-paragraph' ? 'additional-paragraph' : 'continuation', range: content };
}

function nextNonWhitespaceLine(analysis: SourceAnalysis, after: number): SourceLine | null {
	return analysis.lines.find((line) => line.from >= after && line.whitespaceKind === null) ?? null;
}

function terminalFollowing(analysis: SourceAnalysis, after: number): FollowingBoundary {
	const count = [...analysis.source.text.slice(after)].filter((character) => character === '\n').length;
	return count > 0 ? { count, kind: 'terminal-newlines' } : { kind: 'none' };
}

function ordinaryParagraphRange(analysis: SourceAnalysis, firstLine: SourceLine): SourceRange {
	const firstIndex = analysis.lines.indexOf(firstLine);
	let end = firstLine.to;
	for (let index = firstIndex + 1; index < analysis.lines.length; index += 1) {
		const line = analysis.lines[index];
		if (!line || line.whitespaceKind !== null) break;
		if (analysis.items.some((candidate) => candidate.line.from === line.from)) break;
		end = line.to;
	}
	return sourceRange(firstLine.from, end);
}

function externalFollowing(
	analysis: SourceAnalysis,
	item: AnalyzedItem,
	nextSibling: AnalyzedItem | null,
): { readonly following: FollowingBoundary; readonly line: SourceLine | null } {
	if (nextSibling) return { following: { block: nextSibling.block, kind: 'list-item' }, line: nextSibling.line };
	const nextLine = nextNonWhitespaceLine(analysis, item.block.item.to);
	if (!nextLine) return { following: terminalFollowing(analysis, item.block.item.to), line: null };
	const listItem = analysis.items.find((candidate) => candidate.line.from === nextLine.from);
	if (listItem) return { following: { block: listItem.block, kind: 'list-item' }, line: nextLine };
	return {
		following: { kind: 'ordinary-paragraph', range: ordinaryParagraphRange(analysis, nextLine) },
		line: nextLine,
	};
}

function anchorPoints(
	analysis: SourceAnalysis,
	item: AnalyzedItem,
	previousSibling: AnalyzedItem | null,
	owned: readonly OwnedBlock[],
	external: ReturnType<typeof externalFollowing>,
): readonly AnchorPoint[] {
	const points: AnchorPoint[] = [];
	if (previousSibling) {
		points.push({ anchor: 'previous-block', following: null, from: previousSibling.line.from, to: previousSibling.block.item.to });
	}
	points.push({
		anchor: 'current-marker-line',
		following: { block: item.block, kind: 'list-item' },
		from: item.line.from,
		to: item.block.markerLine.to,
	});
	owned.forEach((block, index) => {
		points.push({
			anchor: `owned-block:${index}`,
			following: followingForOwned(analysis, item, block),
			from: block.range.from,
			to: block.range.to,
		});
	});
	points.push({
		anchor: external.line ? 'following-block' : 'document-end',
		following: external.following,
		from: external.line?.from ?? analysis.source.length,
		to: external.line?.to ?? analysis.source.length,
	});
	return points;
}

function itemRelations(analysis: SourceAnalysis, item: AnalyzedItem): ItemRelations {
	const siblings = directSiblingRun(analysis, item);
	const siblingIndex = siblings.indexOf(item);
	const parent = item.parentIndex === null ? null : analysis.items[item.parentIndex] ?? null;
	return {
		nextSibling: siblings[siblingIndex + 1] ?? null,
		parent,
		previousSibling: siblings[siblingIndex - 1] ?? null,
		siblingIndex,
		siblings,
	};
}

function siblingPosition(index: number, count: number): ListTopology['siblingPosition'] {
	if (count === 1) return 'only';
	if (index === 0) return 'first';
	return index === count - 1 ? 'final' : 'middle';
}

function firstFollowing(
	analysis: SourceAnalysis,
	item: AnalyzedItem,
	owned: readonly OwnedBlock[],
	external: ReturnType<typeof externalFollowing>,
): FollowingBoundary {
	const first = owned[0];
	return first ? followingForOwned(analysis, item, first) : external.following;
}

function matchingBoundary(
	boundaries: readonly NormalizedStructuralBoundary[],
	following: FollowingBoundary,
): NormalizedStructuralBoundary | null {
	return boundaries.find((boundary) => sameFollowingBoundary(boundary.following, following)) ?? null;
}

function optionalBlock(item: AnalyzedItem | null): ListBlockRef | null {
	return item ? item.block : null;
}

function precedingBlock(relations: ItemRelations): ListBlockRef | null {
	return optionalBlock(relations.previousSibling) ?? optionalBlock(relations.parent);
}

function orderedIndentStart(analysis: SourceAnalysis, previous: AnalyzedItem | null): number {
	if (!previous) return 1;
	const previousIndex = analysis.items.indexOf(previous);
	const lastChild = analysis.items.filter(candidate => candidate.parentIndex === previousIndex).at(-1);
	if (!lastChild || lastChild.block.prefix.orderedValue === null) return 1;
	const sequence = orderedSequence(lastChild, directSiblingRun(analysis, lastChild));
	if (!sequence) throw new Error('An ordered child requires a normalized ordered sequence');
	return sequence.renderedValue + 1;
}

export function buildListTopology(
	analysis: SourceAnalysis,
	item: AnalyzedItem,
): ListTopology {
	const relations = itemRelations(analysis, item);
	const parentRelations = relations.parent ? itemRelations(analysis, relations.parent) : null;
	const owned = ownedBlocks(analysis, item);
	const external = externalFollowing(analysis, item, relations.nextSibling);
	const points = anchorPoints(analysis, item, relations.previousSibling, owned, external);
	const whitespace = buildWhitespaceFacts(analysis, points);
	const structural = buildNormalizedBoundaries(analysis, points, whitespace);
	const following = firstFollowing(analysis, item, owned, external);
	return {
		atDocumentEnd: nextNonWhitespaceLine(analysis, item.block.item.to) === null,
		atDocumentStart: item.line.from === 0,
		depth: item.depth,
		followingBoundary: following,
		followingStructuralBoundary: matchingBoundary(structural, following),
		nextSibling: optionalBlock(relations.nextSibling),
		orderedSequence: orderedSequence(item, relations.siblings),
		orderedIndentStart: orderedIndentStart(analysis, relations.previousSibling),
		parentOrderedSequence: relations.parent && parentRelations
			? orderedSequence(relations.parent, parentRelations.siblings)
			: null,
		ownedBlocks: owned,
		parent: optionalBlock(relations.parent),
		precedingContainer: precedingBlock(relations),
		previousSibling: optionalBlock(relations.previousSibling),
		siblingPosition: siblingPosition(relations.siblingIndex, relations.siblings.length),
		structuralBoundaries: structural,
		whitespaceBoundaries: whitespace,
	};
}

export function buildProjectionContext(
	analysis: SourceAnalysis,
	item: AnalyzedItem,
	ownedLines: readonly ProjectionOwnedLine[],
): ProjectionListContext {
	const siblings = directSiblingRun(analysis, item);
	return {
		block: item.block,
		depth: item.depth,
		ownedLines,
		orderedSequence: orderedSequence(item, siblings),
	};
}
