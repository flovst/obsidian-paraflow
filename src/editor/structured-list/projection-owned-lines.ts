import type {
	AnalyzedItem,
	SourceAnalysis,
	SourceLine,
} from './context-analysis.js';
import type {
	ProjectionOwnedLine,
	ProjectionOwnedLineKind,
} from './model.js';

interface IndexedItem {
	readonly index: number;
	readonly item: AnalyzedItem;
}

function intersectsLine(item: AnalyzedItem, line: SourceLine): boolean {
	return item.block.item.from <= line.to && line.from < item.block.item.to;
}

function orderedItems(analysis: SourceAnalysis): readonly IndexedItem[] {
	return analysis.items
		.map((item, index) => ({ index, item }))
		.sort((left, right) =>
			left.item.block.item.from - right.item.block.item.from ||
			right.item.block.item.to - left.item.block.item.to ||
			left.index - right.index);
}

function deepestOwner(
	analysis: SourceAnalysis,
	activeIndexes: readonly number[],
	line: SourceLine,
	completeSyntaxAuthority: boolean,
): number | null {
	const containing = activeIndexes.filter((index) => {
		const item = analysis.items[index];
		return item !== undefined && intersectsLine(item, line);
	});
	const deepestDepth = Math.max(...containing.map((index) => analysis.items[index]!.depth));
	const deepest = containing.filter((index) => analysis.items[index]!.depth === deepestDepth);
	if (deepest.length <= 1) return deepest[0] ?? null;
	if (completeSyntaxAuthority) {
		throw new Error('Projection-owned source line has multiple deepest list owners');
	}
	return null;
}

function ownedLine(
	owner: AnalyzedItem,
	line: SourceLine,
	kind: ProjectionOwnedLineKind,
): ProjectionOwnedLine {
	return {
		depth: owner.depth,
		kind,
		ownerKind: owner.block.prefix.kind,
		range: { from: line.from, to: line.to },
		rendering: owner.depth < 6 ? 'projected' : 'native-depth',
	};
}

function ownedKind(
	owner: AnalyzedItem,
	line: SourceLine,
	lastWhitespaceFrom: number | null,
): ProjectionOwnedLineKind {
	if (line.whitespaceKind !== null) return 'blank';
	return lastWhitespaceFrom !== null && lastWhitespaceFrom > owner.line.from
		? 'additional-paragraph'
		: 'continuation';
}

function removeFinishedItems(
	analysis: SourceAnalysis,
	activeIndexes: number[],
	lineFrom: number,
): void {
	for (let index = activeIndexes.length - 1; index >= 0; index -= 1) {
		const active = analysis.items[activeIndexes[index]!];
		if (!active || active.block.item.to <= lineFrom) activeIndexes.splice(index, 1);
	}
}

function addStartingItems(
	items: readonly IndexedItem[],
	activeIndexes: number[],
	nextItem: number,
	line: SourceLine,
): number {
	let next = nextItem;
	while (next < items.length) {
		const current = items[next]!;
		if (current.item.block.item.from > line.to) break;
		if (line.from < current.item.block.item.to) activeIndexes.push(current.index);
		next += 1;
	}
	return next;
}

function appendOwnedLine(
	analysis: SourceAnalysis,
	ownedByItem: ProjectionOwnedLine[][],
	activeIndexes: readonly number[],
	markerLineStarts: ReadonlySet<number>,
	line: SourceLine,
	lastWhitespaceFrom: number | null,
	completeSyntaxAuthority: boolean,
): void {
	if (markerLineStarts.has(line.from)) return;
	const ownerIndex = deepestOwner(analysis, activeIndexes, line, completeSyntaxAuthority);
	if (ownerIndex === null) return;
	const owner = analysis.items[ownerIndex];
	const lines = ownedByItem[ownerIndex];
	if (!owner || !lines) throw new Error('Projection-owned line is missing its analyzed owner');
	lines.push(ownedLine(owner, line, ownedKind(owner, line, lastWhitespaceFrom)));
}

export function buildProjectionOwnedLines(
	analysis: SourceAnalysis,
	completeSyntaxAuthority: boolean,
): readonly (readonly ProjectionOwnedLine[])[] {
	const ownedByItem = analysis.items.map((): ProjectionOwnedLine[] => []);
	const markerLineStarts = new Set(analysis.items.map(({ line }) => line.from));
	const items = orderedItems(analysis);
	const activeIndexes: number[] = [];
	let nextItem = 0;
	let lastWhitespaceFrom: number | null = null;

	for (const line of analysis.lines) {
		removeFinishedItems(analysis, activeIndexes, line.from);
		nextItem = addStartingItems(items, activeIndexes, nextItem, line);
		appendOwnedLine(
			analysis,
			ownedByItem,
			activeIndexes,
			markerLineStarts,
			line,
			lastWhitespaceFrom,
			completeSyntaxAuthority,
		);
		if (line.whitespaceKind !== null) lastWhitespaceFrom = line.from;
	}

	return ownedByItem;
}
