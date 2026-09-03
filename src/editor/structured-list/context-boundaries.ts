import {
	classifyWhitespaceLine,
	isOnlyIndentation,
	sourceRange,
	type SourceAnalysis,
} from './context-analysis.js';
import type {
	BoundaryAnchor,
	FollowingBoundary,
	NormalizedStructuralBoundary,
	RemovableFollowingBoundary,
	SourceRange,
	SourceSnapshot,
	WhitespaceBoundaryFact,
	WhitespaceLineFact,
} from './model.js';

export interface AnchorPoint {
	readonly anchor: BoundaryAnchor;
	readonly from: number;
	readonly to: number;
	readonly following: FollowingBoundary | null;
}

export interface StructuralBoundaryExpectation {
	readonly following: FollowingBoundary;
	readonly fromAnchor: BoundaryAnchor;
	readonly toAnchor: BoundaryAnchor;
	readonly whitespaceRange: SourceRange;
	readonly source: SourceSnapshot;
}

interface BoundaryShape {
	readonly exactAdjacency: boolean;
	readonly followingFrom: number;
	readonly gapTo: number;
	readonly removalTo: number;
	readonly atDocumentEnd: boolean;
}

function whitespaceLines(
	analysis: SourceAnalysis,
	boundaryRange: SourceRange,
): readonly WhitespaceLineFact[] {
	return analysis.lines.flatMap((line): readonly WhitespaceLineFact[] => {
		const isInterior = line.from > boundaryRange.from &&
			line.from < boundaryRange.to &&
			line.newlineTo <= boundaryRange.to;
		if (!isInterior || line.whitespaceKind === null) return [];
		return [{ kind: line.whitespaceKind, range: sourceRange(line.from, line.to), text: line.text }];
	});
}

function boundaryFact(
	analysis: SourceAnalysis,
	from: AnchorPoint,
	to: AnchorPoint,
): WhitespaceBoundaryFact {
	const range = sourceRange(from.to, to.from);
	const text = analysis.source.slice(range);
	return {
		atDocumentEnd: to.anchor === 'document-end',
		fromAnchor: from.anchor,
		lines: whitespaceLines(analysis, range),
		newlineCount: [...text].filter((character) => character === '\n').length,
		range,
		toAnchor: to.anchor,
	};
}

export function buildWhitespaceFacts(
	analysis: SourceAnalysis,
	points: readonly AnchorPoint[],
): readonly WhitespaceBoundaryFact[] {
	return points.slice(1).map((point, index) => boundaryFact(analysis, points[index]!, point));
}

function removableFollowing(following: FollowingBoundary): following is RemovableFollowingBoundary {
	return following.kind !== 'none' && following.kind !== 'unsupported';
}

function validRange(range: SourceRange, sourceLength: number): boolean {
	return Number.isInteger(range.from) && Number.isInteger(range.to) &&
		range.from >= 0 && range.to >= range.from && range.to <= sourceLength;
}

function expectedBoundaryShape(
	following: RemovableFollowingBoundary,
	fact: WhitespaceBoundaryFact,
	sourceLength: number,
): BoundaryShape | null {
	if (following.kind === 'terminal-newlines') {
		if (following.count !== fact.newlineCount) return null;
		return {
			atDocumentEnd: true,
			exactAdjacency: true,
			followingFrom: sourceLength,
			gapTo: sourceLength,
			removalTo: sourceLength,
		};
	}
	if (following.kind === 'list-item') {
		return {
			atDocumentEnd: false,
			exactAdjacency: true,
			followingFrom: following.block.lineFrom,
			gapTo: following.block.prefix.full.from,
			removalTo: following.block.content.from,
		};
	}
	return {
		atDocumentEnd: false,
		exactAdjacency: following.kind === 'ordinary-paragraph',
		followingFrom: following.range.from,
		gapTo: following.range.from,
		removalTo: following.range.from,
	};
}

function sameRange(left: SourceRange, right: SourceRange): boolean {
	return left.from === right.from && left.to === right.to;
}

function derivedLineFact(
	source: SourceSnapshot,
	from: number,
	to: number,
): WhitespaceLineFact | null {
	const text = source.text.slice(from, to);
	const kind = classifyWhitespaceLine(text);
	return kind ? { kind, range: sourceRange(from, to), text } : null;
}

function newlinePositions(source: SourceSnapshot, range: SourceRange): readonly number[] {
	const positions: number[] = [];
	for (let position = range.from; position < range.to; position += 1) {
		if (source.text[position] === '\n') positions.push(position);
	}
	return positions;
}

function factsForRanges(
	source: SourceSnapshot,
	ranges: readonly SourceRange[],
): readonly WhitespaceLineFact[] | null {
	const facts: WhitespaceLineFact[] = [];
	for (const range of ranges) {
		const fact = derivedLineFact(source, range.from, range.to);
		if (!fact) return null;
		facts.push(fact);
	}
	return facts;
}

function deriveCompleteLineFacts(
	source: SourceSnapshot,
	range: SourceRange,
): readonly WhitespaceLineFact[] | null {
	if (range.from === range.to) return [];
	const newlines = newlinePositions(source, range);
	if (newlines[0] !== range.from) return null;
	const ranges = newlines.slice(1).map((position, index) =>
		sourceRange(newlines[index]! + 1, position));
	const trailingFrom = newlines.at(-1)! + 1;
	if (trailingFrom < range.to) ranges.push(sourceRange(trailingFrom, range.to));
	return factsForRanges(source, ranges);
}

function sameLineFact(left: WhitespaceLineFact, right: WhitespaceLineFact): boolean {
	return left.kind === right.kind && left.text === right.text && sameRange(left.range, right.range);
}

function exactBoundaryLines(
	fact: WhitespaceBoundaryFact,
	source: SourceSnapshot,
): boolean {
	const expected = deriveCompleteLineFacts(source, fact.range);
	return expected !== null && expected.length === fact.lines.length &&
		expected.every((line, index) => sameLineFact(line, fact.lines[index]!));
}

function validWhitespaceFact(
	fact: WhitespaceBoundaryFact,
	expectation: StructuralBoundaryExpectation,
): boolean {
	if (fact.fromAnchor !== expectation.fromAnchor || fact.toAnchor !== expectation.toAnchor) return false;
	if (!sameRange(fact.range, expectation.whitespaceRange)) return false;
	if (!validRange(fact.range, expectation.source.length)) return false;
	const text = expectation.source.slice(fact.range);
	const newlineCount = [...text].filter((character) => character === '\n').length;
	return newlineCount === fact.newlineCount && exactBoundaryLines(fact, expectation.source);
}

function boundaryIsAdjacent(shape: BoundaryShape, fact: WhitespaceBoundaryFact): boolean {
	return shape.exactAdjacency
		? fact.range.to === shape.followingFrom
		: fact.range.to <= shape.followingFrom;
}

function boundaryMatchesSource(
	shape: BoundaryShape,
	fact: WhitespaceBoundaryFact,
	expectation: StructuralBoundaryExpectation,
): boolean {
	if (!boundaryIsAdjacent(shape, fact)) return false;
	if (fact.atDocumentEnd !== shape.atDocumentEnd) return false;
	if (shape.gapTo < fact.range.to) return false;
	return isOnlyIndentation(expectation.source.text.slice(fact.range.to, shape.gapTo));
}

function sameNullableRange(left: SourceRange | null, right: SourceRange | null): boolean {
	if (left === null || right === null) return left === right;
	return sameRange(left, right);
}

function samePrefixIdentity(
	left: Extract<FollowingBoundary, { readonly kind: 'list-item' }>['block']['prefix'],
	right: Extract<FollowingBoundary, { readonly kind: 'list-item' }>['block']['prefix'],
): boolean {
	return left.kind === right.kind &&
		left.markerText === right.markerText &&
		left.orderedValue === right.orderedValue &&
		left.indentText === right.indentText &&
		left.separatorText === right.separatorText &&
		sameRange(left.full, right.full) &&
		sameRange(left.outerMarker, right.outerMarker) &&
		sameNullableRange(left.taskToken, right.taskToken);
}

function sameBlockIdentity(
	left: Extract<FollowingBoundary, { readonly kind: 'list-item' }>['block'],
	right: Extract<FollowingBoundary, { readonly kind: 'list-item' }>['block'],
): boolean {
	return sameRange(left.item, right.item) &&
		sameRange(left.markerLine, right.markerLine) &&
		sameRange(left.content, right.content) &&
		left.lineFrom === right.lineFrom &&
		left.contentIndentText === right.contentIndentText &&
		samePrefixIdentity(left.prefix, right.prefix);
}

function sameListIdentity(left: FollowingBoundary, right: FollowingBoundary): boolean {
	return left.kind === 'list-item' && right.kind === 'list-item' &&
		sameBlockIdentity(left.block, right.block);
}

function sameTerminalIdentity(left: FollowingBoundary, right: FollowingBoundary): boolean {
	return left.kind === 'terminal-newlines' && right.kind === 'terminal-newlines' &&
		left.count === right.count;
}

function sameRangedIdentity(left: FollowingBoundary, right: FollowingBoundary): boolean {
	return 'range' in left && 'range' in right && left.kind === right.kind &&
		sameRange(left.range, right.range);
}

function sameEmptyIdentity(left: FollowingBoundary, right: FollowingBoundary): boolean {
	return left.kind === right.kind && (left.kind === 'none' || left.kind === 'unsupported');
}

export function sameFollowingBoundary(left: FollowingBoundary, right: FollowingBoundary): boolean {
	return sameListIdentity(left, right) ||
		sameTerminalIdentity(left, right) ||
		sameRangedIdentity(left, right) ||
		sameEmptyIdentity(left, right);
}

function validBoundaryRequest(
	index: number,
	following: FollowingBoundary,
	removalRange: SourceRange,
	expectation: StructuralBoundaryExpectation,
): following is RemovableFollowingBoundary {
	return removableFollowing(following) &&
		sameFollowingBoundary(following, expectation.following) &&
		Number.isInteger(index) && index >= 0 &&
		validRange(removalRange, expectation.source.length);
}

function uniqueMatchingFact(
	facts: readonly WhitespaceBoundaryFact[],
	expectation: StructuralBoundaryExpectation,
): WhitespaceBoundaryFact | null {
	const matching = facts.filter((fact) => validWhitespaceFact(fact, expectation));
	return matching.length === 1 ? matching[0]! : null;
}

function removalMatches(
	removalRange: SourceRange,
	fact: WhitespaceBoundaryFact,
	shape: BoundaryShape,
): boolean {
	return removalRange.from === fact.range.from && removalRange.to === shape.removalTo;
}

export function normalizeStructuralBoundary(
	index: number,
	following: FollowingBoundary,
	whitespaceFacts: readonly WhitespaceBoundaryFact[],
	removalRange: SourceRange,
	expectation: StructuralBoundaryExpectation,
): NormalizedStructuralBoundary | null {
	if (!validBoundaryRequest(index, following, removalRange, expectation)) return null;
	const fact = uniqueMatchingFact(whitespaceFacts, expectation);
	if (!fact) return null;
	const shape = expectedBoundaryShape(following, fact, expectation.source.length);
	if (!shape || !boundaryMatchesSource(shape, fact, expectation)) return null;
	if (!removalMatches(removalRange, fact, shape)) return null;
	return {
		following,
		id: `structural-boundary:${index}`,
		removalRange: sourceRange(removalRange.from, removalRange.to),
		whitespace: fact,
		whitespaceIndex: index,
	};
}

function removalEnd(following: FollowingBoundary, target: AnchorPoint, sourceLength: number): number {
	if (following.kind === 'list-item') return following.block.content.from;
	if (following.kind === 'continuation' || following.kind === 'additional-paragraph') {
		return following.range.from;
	}
	if (following.kind === 'ordinary-paragraph') return following.range.from;
	return target.anchor === 'document-end' ? sourceLength : target.from;
}

function normalizePointBoundary(
	analysis: SourceAnalysis,
	previous: AnchorPoint,
	target: AnchorPoint,
	fact: WhitespaceBoundaryFact,
	index: number,
): NormalizedStructuralBoundary | null {
	if (!target.following) return null;
	const removalTo = removalEnd(target.following, target, analysis.source.length);
	return normalizeStructuralBoundary(
		index,
		target.following,
		[fact],
		sourceRange(fact.range.from, removalTo),
		{
			following: target.following,
			fromAnchor: previous.anchor,
			source: analysis.source,
			toAnchor: target.anchor,
			whitespaceRange: sourceRange(previous.to, target.from),
		},
	);
}

export function buildNormalizedBoundaries(
	analysis: SourceAnalysis,
	points: readonly AnchorPoint[],
	whitespace: readonly WhitespaceBoundaryFact[],
): readonly NormalizedStructuralBoundary[] {
	const boundaries: NormalizedStructuralBoundary[] = [];
	for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
		const previous = points[pointIndex - 1];
		const target = points[pointIndex];
		const fact = whitespace[pointIndex - 1];
		const normalized = previous && target && fact
			? normalizePointBoundary(analysis, previous, target, fact, pointIndex - 1)
			: null;
		if (normalized) boundaries.push(normalized);
	}
	return boundaries;
}
