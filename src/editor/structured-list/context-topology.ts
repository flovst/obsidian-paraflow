import {
	containingLine,
	ownedBodyStart,
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

interface TopologyIndex {
	readonly relations: ReadonlyMap<AnalyzedItem, ItemRelations>;
	readonly sequences: ReadonlyMap<AnalyzedItem, OrderedSequenceContext>;
	readonly byMarker: ReadonlyMap<number, readonly AnalyzedItem[]>;
	readonly positions: ReadonlyMap<AnalyzedItem, number>;
	readonly children: ReadonlyMap<number | null, readonly AnalyzedItem[]>;
	readonly starts: readonly number[];
	readonly ends: readonly number[];
}

// The key is one immutable analysis, never an EditorState or source Text.
const topologyIndexes = new WeakMap<SourceAnalysis, TopologyIndex>();

function siblingIndexes(analysis: SourceAnalysis, children: ReadonlyMap<number | null, readonly AnalyzedItem[]>) {
	const relations = new Map<AnalyzedItem, ItemRelations>();
	const sequences = new Map<AnalyzedItem, OrderedSequenceContext>();
	for (const candidates of children.values()) {
		let start = 0;
		while (start < candidates.length) {
			let end = start + 1;
			while (end < candidates.length && siblingsAreAdjacent(analysis, candidates[end - 1], candidates[end])) end++;
			const siblings = candidates.slice(start, end);
			const firstValue = siblings[0]!.block.prefix.orderedValue;
			const blocks = firstValue === null ? null : siblings.map(candidate => candidate.block);
			siblings.forEach((item, siblingIndex) => {
				relations.set(item, { siblings, siblingIndex, previousSibling: siblings[siblingIndex - 1] ?? null,
					nextSibling: siblings[siblingIndex + 1] ?? null,
					parent: item.parentIndex === null ? null : analysis.items[item.parentIndex] ?? null });
				if (blocks && firstValue !== null) sequences.set(item, { currentIndex: siblingIndex, items: blocks, renderedValue: firstValue + siblingIndex });
			});
			start = end;
		}
	}
	return { relations, sequences };
}

function topologyIndex(analysis: SourceAnalysis): TopologyIndex {
	const cached = topologyIndexes.get(analysis);
	if (cached) return cached;
	const children = new Map<number | null, AnalyzedItem[]>();
	const byMarker = new Map<number, AnalyzedItem[]>();
	const positions = new Map<AnalyzedItem, number>();
	analysis.items.forEach((item, index) => {
		positions.set(item, index);
		const siblings = children.get(item.parentIndex) ?? [];
		siblings.push(item); children.set(item.parentIndex, siblings);
		const markers = byMarker.get(item.line.from) ?? [];
		markers.push(item); byMarker.set(item.line.from, markers);
	});
	const { relations, sequences } = siblingIndexes(analysis, children);
	const starts: number[] = [], ends: number[] = [];
	let clock = 0;
	const pending = (children.get(null) ?? []).map(item => ({ item, exit: false })).reverse();
	while (pending.length) {
		const { item, exit } = pending.pop()!;
		const index = positions.get(item)!;
		if (exit) { ends[index] = clock; continue; }
		starts[index] = clock++;
		pending.push({ item, exit: true });
		const nested = children.get(index) ?? [];
		for (let at = nested.length - 1; at >= 0; at--) pending.push({ item: nested[at]!, exit: false });
	}
	const result = { relations, sequences, byMarker, positions, children, starts, ends };
	topologyIndexes.set(analysis, result);
	return result;
}

function orderedSequence(analysis: SourceAnalysis, item: AnalyzedItem): OrderedSequenceContext | null {
	return topologyIndex(analysis).sequences.get(item) ?? null;
}

/** Sweep only this owner's descendants, retaining depth and original-order ties. */
function descendantOwners(analysis: SourceAnalysis, item: AnalyzedItem): ReadonlyMap<SourceLine, AnalyzedItem> {
	const index = topologyIndex(analysis), root = index.positions.get(item)!;
	const descendants = analysis.items.map((candidate, order) => ({ candidate, order }))
		.filter(({ order }) => index.starts[root]! < index.starts[order]! && index.starts[order]! < index.ends[root]!)
		.map(({ candidate, order }) => ({ candidate, order, from: candidate.block.item.from, to: candidate.block.item.to, depth: candidate.depth }))
		.sort((a, b) => a.from - b.from || a.order - b.order);
	type Owner = typeof descendants[number];
	const heap: Owner[] = [];
	const better = (a: Owner, b: Owner) => a.depth > b.depth || a.depth === b.depth && a.order < b.order;
	const push = (owner: Owner) => {
		let at = heap.length; heap.push(owner);
		while (at > 0) {
			const parent = (at - 1) >>> 1;
			if (!better(owner, heap[parent]!)) break;
			heap[at] = heap[parent]!; at = parent;
		}
		heap[at] = owner;
	};
	const pop = () => {
		const tail = heap.pop()!;
		if (!heap.length) return;
		let at = 0;
		while (at * 2 + 1 < heap.length) {
			let child = at * 2 + 1;
			if (child + 1 < heap.length && better(heap[child + 1]!, heap[child]!)) child++;
			if (!better(heap[child]!, tail)) break;
			heap[at] = heap[child]!; at = child;
		}
		heap[at] = tail;
	};
	const owners = new Map<SourceLine, AnalyzedItem>();
	let cursor = 0;
	for (const line of analysis.lines.filter(line => item.line.from < line.from && line.from < item.block.item.to)) {
		while (cursor < descendants.length && descendants[cursor]!.from <= line.to) push(descendants[cursor++]!);
		while (heap.length && heap[0]!.to <= line.from) pop();
		owners.set(line, heap[0]?.candidate ?? item);
	}
	return owners;
}

function ownedBlockKind(line: SourceLine, descendant: boolean, paragraphBroken: boolean): OwnedBlock['kind'] {
	if (line.codeLeaf) return 'code-leaf';
	if (descendant) return 'descendant';
	return paragraphBroken ? 'additional-paragraph' : 'continuation';
}

function ownedBlocks(analysis: SourceAnalysis, item: AnalyzedItem): readonly OwnedBlock[] {
	const owned: OwnedBlock[] = [];
	let paragraphBroken = false;
	const owners = descendantOwners(analysis, item);
	for (const line of analysis.lines) {
		if (line.from <= item.line.from || line.from >= item.block.item.to) continue;
		const owner = owners.get(line)!;
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
		const descendant = topologyIndex(analysis).byMarker.get(owned.range.from)?.find(candidate => candidate.depth > item.depth);
		if (descendant) return { block: descendant.block, kind: 'list-item' };
	}
	const line = containingLine(analysis.lines, owned.range.from);
	const content = sourceRange(ownedBodyStart(line), line.to);
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

function physicalPrecedingItem(analysis: SourceAnalysis, item: AnalyzedItem): AnalyzedItem | null {
	if (item.depth !== 0 || item.block.prefix.outerMarker.from === item.line.from) return null;
	const previous = analysis.items.filter(candidate => candidate.line.from < item.line.from).at(-1);
	if (!previous || previous.block.prefix.outerMarker.from - previous.line.from !==
		item.block.prefix.outerMarker.from - item.line.from) return null;
	return analysis.source.text.slice(previous.block.item.to,item.line.from) === '\n\n\n' ? previous : null;
}

function itemRelations(analysis: SourceAnalysis, item: AnalyzedItem): ItemRelations {
	return topologyIndex(analysis).relations.get(item)!;
}

function indentParent(analysis: SourceAnalysis, item: AnalyzedItem): AnalyzedItem | null {
	const previous = analysis.items.filter(candidate => candidate.parentIndex === item.parentIndex &&
		candidate.line.from < item.line.from).at(-1);
	if (!previous) return null;
	const from = previous.block.item.to;
	return isOnlyBoundaryWhitespace(analysis.source.text.slice(from, item.line.from)) &&
		(itemFamily(previous) !== itemFamily(item) || !hasListGroupBoundary(analysis.source.text, from, item.line.from)) ? previous : null;
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
	const index = topologyIndex(analysis);
	const previousIndex = index.positions.get(previous)!;
	const lastChild = index.children.get(previousIndex)?.at(-1);
	if (!lastChild || lastChild.block.prefix.orderedValue === null) return 1;
	const sequence = orderedSequence(analysis, lastChild);
	if (!sequence) throw new Error('An ordered child requires a normalized ordered sequence');
	return sequence.renderedValue + 1;
}

export function buildListTopology(
	analysis: SourceAnalysis,
	item: AnalyzedItem,
): ListTopology {
	const relations = itemRelations(analysis, item);
	const tabParent = indentParent(analysis, item);
	const parentRelations = relations.parent ? itemRelations(analysis, relations.parent) : null;
	const owned = ownedBlocks(analysis, item);
	const external = externalFollowing(analysis, item, relations.nextSibling);
	// Physical paragraph boundaries survive even when two empty rows end sibling membership.
	const points = anchorPoints(analysis, item, relations.previousSibling ?? physicalPrecedingItem(analysis,item), owned, external);
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
		orderedSequence: orderedSequence(analysis, item),
		orderedIndentStart: orderedIndentStart(analysis, tabParent),
		parentOrderedSequence: relations.parent && parentRelations
			? orderedSequence(analysis, relations.parent)
			: null,
		ownedBlocks: owned,
		parent: optionalBlock(relations.parent),
		precedingContainer: precedingBlock(relations),
		previousSibling: optionalBlock(relations.previousSibling),
		indentParent: optionalBlock(tabParent),
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
	return {
		block: item.block,
		blankRuns: analysis.blankRunsByOwner.get(item.line.from) ?? [],
		depth: item.depth,
		ownedLines,
		orderedSequence: orderedSequence(analysis, item),
	};
}
