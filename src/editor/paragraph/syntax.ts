import { language, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type {
	AtxHeadingBlock,
	ParagraphAuthority,
	ParagraphBlock,
	ParagraphGap,
	ParagraphPhysicalRow,
	ParagraphRun,
	TopLevelBlockBoundary,
	TopLevelBlockBoundaryKind,
} from './model.js';
import { capabilitiesForTopLevelBlock } from './model.js';
import { isSeparatorlessListMarkerLine } from '../structured-list/prefix.js';
import { enumerateListItems, isObsidianListLineName } from '../structured-list/syntax.js';

const newlineRunPattern = /^\n{2,}$/u;

function nodeNameTokens(name: string): readonly string[] {
	return name.split(/[\s_]+/u);
}

function isHypermdBlockNode(node: SyntaxNode): boolean {
	const tokens = nodeNameTokens(node.name);
	return tokens.some((token) => token.startsWith('HyperMD-')) ||
		tokens.some((token) => [
			'hmd-codeblock',
			'hmd-html-begin',
			'hmd-html-end',
			'hmd-indented-code',
			'math-block',
		].includes(token));
}

export interface InlineHtmlBreakRange {
	readonly from: number;
	readonly to: number;
}

export function inlineHtmlBreakRangeForNode(
	state: EditorState,
	node: SyntaxNode,
): InlineHtmlBreakRange | null {
	const source = state.doc.sliceString(node.from, node.to);
	if (/^<br\s*\/?\s*>$/iu.test(source)) return { from: node.from, to: node.to };

	const isHtmlToken = nodeNameTokens(node.name).some((token) =>
		token === 'hmd-html-begin' || token === 'hmd-html-end');
	if (!isHtmlToken) return null;

	const line = state.doc.lineAt(node.from);
	for (const match of line.text.matchAll(/<br\s*\/?\s*>/giu)) {
		if (match.index === undefined) continue;
		const from = line.from + match.index;
		const to = from + match[0].length;
		if (node.from < to && from < node.to) return { from, to };
	}
	return null;
}

function isHypermdBlockNodeForState(state: EditorState, node: SyntaxNode): boolean {
	return isHypermdBlockNode(node) && !inlineHtmlBreakRangeForNode(state, node);
}

function hypermdListLevel(name: string): number | null {
	for (const token of nodeNameTokens(name)) {
		const match = /^HyperMD-list-line-(\d+)$/u.exec(token);
		if (match) return Number(match[1]);
	}
	return null;
}

function isHypermdHeadingName(name: string): boolean {
	const tokens = nodeNameTokens(name);
	return !tokens.includes('HyperMD-list-line') &&
		!tokens.some((token) => token.startsWith('HyperMD-quote')) &&
		tokens.some((token) => token.startsWith('HyperMD-header-'));
}

function isHypermdState(state: EditorState): boolean {
	if (state.facet(language)?.name === 'hypermd') return true;
	let found = false;
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name !== 'Document' && isHypermdBlockNodeForState(state, node.node)) found = true;
		},
	});
	return found;
}

function lineContentEdge(
	state: EditorState,
	position: number,
	edge: 'start' | 'end',
): number {
	const line = state.doc.lineAt(position);
	if (edge === 'start') return line.from + (/^[ \t]*/u.exec(line.text)?.[0].length ?? 0);
	return line.to - (/[ \t]*$/u.exec(line.text)?.[0].length ?? 0);
}

function hypermdDelimitedBoundaries(state: EditorState): readonly TopLevelBlockBoundary[] {
	const boundaries: TopLevelBlockBoundary[] = [];
	let mathStartLine: number | null = null;
	let htmlStartLine: number | null = null;
	syntaxTree(state).iterate({
		enter: (node) => {
			const tokens = nodeNameTokens(node.name);
			const inlineHtmlBreak = inlineHtmlBreakRangeForNode(state, node.node);
			if (tokens.includes('math-block') &&
				node.from === lineContentEdge(state, node.from, 'start')) {
				mathStartLine = state.doc.lineAt(node.from).number;
			} else if (mathStartLine !== null && tokens.includes('formatting-math-end') &&
				node.to === lineContentEdge(state, node.to, 'end')) {
				boundaries.push({
					from: state.doc.line(mathStartLine).from,
					kind: 'math-block',
					to: state.doc.lineAt(node.to).to,
				});
				mathStartLine = null;
			}

			if (!inlineHtmlBreak && tokens.includes('hmd-html-begin') &&
				node.from === lineContentEdge(state, node.from, 'start')) {
				htmlStartLine = state.doc.lineAt(node.from).number;
			} else if (!inlineHtmlBreak && htmlStartLine !== null && tokens.includes('hmd-html-end') &&
				node.to === lineContentEdge(state, node.to, 'end')) {
				boundaries.push({
					from: state.doc.line(htmlStartLine).from,
					kind: 'html-block',
					to: state.doc.lineAt(node.to).to,
				});
				htmlStartLine = null;
			}
		},
	});
	if (mathStartLine !== null) {
		boundaries.push({
			from: state.doc.line(mathStartLine).from,
			kind: 'math-block',
			to: state.doc.length,
		});
	}
	if (htmlStartLine !== null) {
		boundaries.push({
			from: state.doc.line(htmlStartLine).from,
			kind: 'html-block',
			to: state.doc.length,
		});
	}
	return boundaries;
}

function blockedHypermdLines(state: EditorState): ReadonlySet<number> {
	const blocked = new Set<number>();
	syntaxTree(state).iterate({
		enter: (node) => {
			if (!isHypermdBlockNodeForState(state, node.node)) return;
			const fromLine = state.doc.lineAt(node.from).number;
			const toLine = state.doc.lineAt(Math.max(node.from, node.to)).number;
			for (let line = fromLine; line <= toLine; line += 1) blocked.add(line);
		},
	});
	for (const boundary of hypermdDelimitedBoundaries(state)) {
		const fromLine = state.doc.lineAt(boundary.from).number;
		const toLine = state.doc.lineAt(boundary.to).number;
		for (let line = fromLine; line <= toLine; line += 1) blocked.add(line);
	}
	return blocked;
}

interface HypermdBlockRange extends ParagraphGap {
	readonly name: string;
}

function directHypermdBlockRangesAround(
	state: EditorState,
	ranges: readonly ParagraphGap[],
	includeAdjacentLines = false,
): readonly HypermdBlockRange[] {
	if (!isHypermdState(state)) return [];
	const blocks = new Map<string, HypermdBlockRange>();
	for (const range of ranges) {
		const from = Math.max(0, Math.min(range.from, state.doc.length));
		const to = Math.max(from, Math.min(range.to, state.doc.length));
		const fromLine = state.doc.lineAt(from);
		const toLine = state.doc.lineAt(to);
		const queryFrom = includeAdjacentLines && fromLine.number > 1
			? state.doc.line(fromLine.number - 1).from
			: Math.max(0, from - 1);
		const queryTo = includeAdjacentLines && toLine.number < state.doc.lines
			? state.doc.line(toLine.number + 1).to
			: Math.min(state.doc.length, Math.max(to, from + 1));
		syntaxTree(state).iterate({
			from: queryFrom,
			to: queryTo,
			enter: (node) => {
				if (!isHypermdBlockNodeForState(state, node.node)) return;
				if (!includeAdjacentLines && (node.from > to || from > node.to)) return;
				blocks.set(`${node.from}:${node.to}:${node.name}`, {
					from: node.from,
					name: node.name,
					to: node.to,
				});
			},
		});
	}
	return [...blocks.values()].sort((left, right) =>
		left.from - right.from || left.to - right.to);
}

function hypermdBlockFamily(name: string): string | null {
	const tokens = nodeNameTokens(name);
	if (tokens.some((token) => token.startsWith('HyperMD-quote'))) return 'HyperMD-quote';
	if (tokens.includes('HyperMD-list-line')) return 'HyperMD-list-line';
	if (tokens.some((token) => token.startsWith('HyperMD-codeblock')) ||
		tokens.includes('hmd-codeblock')) return 'HyperMD-codeblock';
	if (tokens.some((token) => token.startsWith('HyperMD-table'))) return 'HyperMD-table';
	if (tokens.includes('hmd-html-begin') || tokens.includes('hmd-html-end')) return 'hmd-html';
	if (tokens.includes('hmd-indented-code')) return 'hmd-indented-code';
	if (tokens.includes('math-block')) return 'math-block';
	if (tokens.some((token) => token.startsWith('HyperMD-header'))) return null;
	return '*';
}

function hypermdBlockFamilyLines(
	state: EditorState,
): ReadonlyMap<string, ReadonlySet<number>> {
	const lines = new Map<string, Set<number>>();
	syntaxTree(state).iterate({
		enter: (node) => {
			if (!isHypermdBlockNodeForState(state, node.node)) return;
			const family = hypermdBlockFamily(node.name);
			if (family === null || family === '*') return;
			const familyLines = lines.get(family) ?? new Set<number>();
			const fromLine = state.doc.lineAt(node.from).number;
			const toLine = state.doc.lineAt(Math.max(node.from, node.to)).number;
			for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
				familyLines.add(lineNumber);
			}
			lines.set(family, familyLines);
		},
	});
	return lines;
}

export function hypermdBlockRangesAround(
	state: EditorState,
	ranges: readonly ParagraphGap[],
): readonly ParagraphGap[] {
	const direct = directHypermdBlockRangesAround(state, ranges, true);
	if (direct.length === 0) return [];
	const familyLines = hypermdBlockFamilyLines(state);
	const components = direct.map((range) => {
		const family = hypermdBlockFamily(range.name);
		if (family === null) return { from: range.from, to: range.to };
		if (family === '*') return { from: 0, to: state.doc.length };
		let fromLine = state.doc.lineAt(range.from).number;
		let toLine = state.doc.lineAt(range.to).number;
		while (fromLine > 1) {
			const lineNumber = fromLine - 1;
			const line = state.doc.line(lineNumber);
			if (line.text.trim().length > 0 &&
				!familyLines.get(family)?.has(lineNumber)) break;
			fromLine = lineNumber;
		}
		while (toLine < state.doc.lines) {
			const lineNumber = toLine + 1;
			const line = state.doc.line(lineNumber);
			if (line.text.trim().length > 0 &&
				!familyLines.get(family)?.has(lineNumber)) break;
			toLine = lineNumber;
		}
		return {
			from: state.doc.line(fromLine).from,
			to: state.doc.line(toLine).to,
		};
	});
	const merged: ParagraphGap[] = [];
	for (const component of components.sort((left, right) => left.from - right.from)) {
		const previous = merged.at(-1);
		if (!previous || component.from > previous.to + 1) {
			merged.push(component);
			continue;
		}
		merged[merged.length - 1] = {
			from: previous.from,
			to: Math.max(previous.to, component.to),
		};
	}
	return merged;
}

function hypermdParagraphs(state: EditorState): readonly TopLevelBlockBoundary[] {
	// HyperMD omits syntax nodes for unstyled text. Complete token coverage still
	// proves ordinary lines by excluding every host-marked block line.
	const blocked = blockedHypermdLines(state);
	const paragraphs: TopLevelBlockBoundary[] = [];
	let open: TopLevelBlockBoundary | null = null;
	for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
		const line = state.doc.line(lineNumber);
		const ordinary = line.text.trim().length > 0 && !blocked.has(lineNumber);
		if (ordinary) {
			open = open
				? { from: open.from, kind: open.kind, to: line.to }
				: { from: line.from, kind: 'paragraph', to: line.to };
			continue;
		}
		if (open) paragraphs.push(open);
		open = null;
	}
	if (open) paragraphs.push(open);
	return paragraphs;
}

type HypermdLineKind = 'ordinary' | 'blank' | 'blocked';

interface HypermdLineEnvelope {
	readonly fromLine: number;
	readonly toLine: number;
}

interface HypermdAuthoritySlice {
	readonly coveredRanges: readonly ParagraphGap[];
}

function hypermdLineKind(
	state: EditorState,
	lineNumber: number,
	cache: Map<number, HypermdLineKind>,
): HypermdLineKind {
	const cached = cache.get(lineNumber);
	if (cached) return cached;
	const line = state.doc.line(lineNumber);
	const blocked = directHypermdBlockRangesAround(state, [{ from: line.from, to: line.to }])
		.length > 0;
	const kind = blocked ? 'blocked' : line.text.trim().length === 0 ? 'blank' : 'ordinary';
	cache.set(lineNumber, kind);
	return kind;
}

function expandHypermdEnvelope(
	state: EditorState,
	range: ParagraphGap,
	cache: Map<number, HypermdLineKind>,
): HypermdLineEnvelope {
	const fromPosition = Math.max(0, Math.min(range.from - 1, state.doc.length));
	const toPosition = Math.max(0, Math.min(range.to + 1, state.doc.length));
	let fromLine = state.doc.lineAt(fromPosition).number;
	let toLine = state.doc.lineAt(toPosition).number;

	if (hypermdLineKind(state, fromLine, cache) !== 'blocked') {
		let previous = hypermdLineKind(state, fromLine, cache);
		let externalParagraph = false;
		for (let line = fromLine - 1; line >= 1; line -= 1) {
			const current = hypermdLineKind(state, line, cache);
			if (current === 'blocked' || (externalParagraph && current !== 'ordinary')) break;
			if (current === 'ordinary' && previous !== 'ordinary') externalParagraph = true;
			fromLine = line;
			previous = current;
		}
	}

	if (hypermdLineKind(state, toLine, cache) !== 'blocked') {
		let previous = hypermdLineKind(state, toLine, cache);
		let externalParagraph = false;
		for (let line = toLine + 1; line <= state.doc.lines; line += 1) {
			const current = hypermdLineKind(state, line, cache);
			if (current === 'blocked' || (externalParagraph && current !== 'ordinary')) break;
			if (current === 'ordinary' && previous !== 'ordinary') externalParagraph = true;
			toLine = line;
			previous = current;
		}
	}
	return { fromLine, toLine };
}

function mergeHypermdEnvelopes(
	envelopes: readonly HypermdLineEnvelope[],
): readonly HypermdLineEnvelope[] {
	const merged: HypermdLineEnvelope[] = [];
	for (const envelope of [...envelopes].sort((left, right) => left.fromLine - right.fromLine)) {
		const previous = merged.at(-1);
		if (!previous || envelope.fromLine > previous.toLine + 1) {
			merged.push({ ...envelope });
			continue;
		}
		merged[merged.length - 1] = {
			fromLine: previous.fromLine,
			toLine: Math.max(previous.toLine, envelope.toLine),
		};
	}
	return merged;
}

function hypermdAuthoritySlice(
	state: EditorState,
	ranges: readonly ParagraphGap[],
): HypermdAuthoritySlice {
	const blockRanges = hypermdBlockRangesAround(state, ranges);
	const seeds = [...ranges, ...blockRanges];
	const cache = new Map<number, HypermdLineKind>();
	const envelopes = mergeHypermdEnvelopes(
		seeds.map((range) => expandHypermdEnvelope(state, range, cache)),
	);
	return {
		coveredRanges: envelopes.map((envelope) => ({
			from: state.doc.line(envelope.fromLine).from,
			to: state.doc.line(envelope.toLine).to,
		})),
	};
}

export interface ParagraphAuthoritySlice {
	readonly authority: ParagraphAuthority;
	readonly coveredRanges: readonly ParagraphGap[];
}

function standardBoundaryBlocks(nodes: readonly SyntaxNode[]): readonly TopLevelBlockBoundary[] {
	const boundaries: TopLevelBlockBoundary[] = [];
	for (const node of nodes) {
		if (node.name === 'Paragraph') {
			boundaries.push({ from: node.from, kind: 'paragraph', to: node.to });
			continue;
		}
		if (/^(?:ATXHeading[1-6]|SetextHeading[12])$/u.test(node.name)) {
			boundaries.push({ from: node.from, kind: 'heading', to: node.to });
			continue;
		}
		const complexKind: TopLevelBlockBoundaryKind | null = node.name === 'Blockquote'
			? 'blockquote'
			: node.name === 'FencedCode'
				? 'code-block'
				: node.name === 'Table'
					? 'table'
					: node.name === 'HorizontalRule'
						? 'thematic-break'
						: node.name === 'HTMLBlock' ? 'html-block' : null;
		if (complexKind) {
			boundaries.push({ from: node.from, kind: complexKind, to: node.to });
			continue;
		}
		if (node.name !== 'BulletList' && node.name !== 'OrderedList') continue;
		for (let item = node.firstChild; item; item = item.nextSibling) {
			if (item.name === 'ListItem') {
				boundaries.push({ from: item.from, kind: 'list-item', to: item.to });
			}
		}
	}
	return boundaries;
}

function hypermdComplexKind(name: string): TopLevelBlockBoundaryKind | null {
	const tokens = nodeNameTokens(name);
	if (tokens.some((token) => token.startsWith('HyperMD-quote'))) return 'blockquote';
	if (tokens.some((token) => token.startsWith('HyperMD-codeblock')) ||
		tokens.includes('hmd-codeblock')) return 'code-block';
	if (tokens.some((token) => token.startsWith('HyperMD-table'))) return 'table';
	if (tokens.some((token) => token.startsWith('HyperMD-hr'))) return 'thematic-break';
	return null;
}

function hypermdComplexBoundaries(state: EditorState): readonly TopLevelBlockBoundary[] {
	const lines = new Map<number, TopLevelBlockBoundaryKind>();
	const assign = (fromLine: number, toLine: number, kind: TopLevelBlockBoundaryKind): void => {
		for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
			const existing = lines.get(lineNumber);
			if (existing && existing !== kind) {
				throw new Error('Conflicting complete HyperMD block containment');
			}
			lines.set(lineNumber, kind);
		}
	};
	syntaxTree(state).iterate({
		enter: (node) => {
			const kind = hypermdComplexKind(node.name);
			if (!kind) return;
			const fromLine = state.doc.lineAt(node.from).number;
			const finalPosition = node.to > node.from ? node.to - 1 : node.to;
			const toLine = state.doc.lineAt(finalPosition).number;
			assign(fromLine, toLine, kind);
		},
	});
	for (const boundary of hypermdDelimitedBoundaries(state)) {
		assign(
			state.doc.lineAt(boundary.from).number,
			state.doc.lineAt(boundary.to).number,
			boundary.kind,
		);
	}
	const sorted = [...lines].sort(([left], [right]) => left - right);
	const boundaries: TopLevelBlockBoundary[] = [];
	for (const [lineNumber, kind] of sorted) {
		const line = state.doc.line(lineNumber);
		const previous = boundaries.at(-1);
		if (previous && previous.kind === kind &&
			state.doc.lineAt(previous.to).number + 1 === lineNumber) {
			boundaries[boundaries.length - 1] = { ...previous, to: line.to };
			continue;
		}
		boundaries.push({ from: line.from, kind, to: line.to });
	}
	return boundaries;
}

function separatorlessListLiteralLines(
	state: EditorState,
	within?: readonly ParagraphGap[],
): readonly TopLevelBlockBoundary[] {
	const lines = new Map<number, TopLevelBlockBoundary>();
	const scan = (from?: number, to?: number): void => {
		syntaxTree(state).iterate({
			...(from === undefined ? {} : { from }),
			...(to === undefined ? {} : { to }),
			enter: (node) => {
				if (node.name !== 'ListItem' && !isObsidianListLineName(node.name)) return;
				const line = state.doc.lineAt(node.from);
				if (!isSeparatorlessListMarkerLine(line.text)) return;
				lines.set(line.from, {
					from: line.from,
					kind: 'separatorless-list-literal',
					to: line.to,
				});
			},
		});
	};
	if (within === undefined) {
		scan();
	} else {
		for (const range of within) scan(range.from, range.to);
	}
	return [...lines.values()].sort((left, right) => left.from - right.from);
}

function trimBoundarySegment(
	state: EditorState,
	boundary: TopLevelBlockBoundary,
	from: number,
	to: number,
): TopLevelBlockBoundary | null {
	if (from >= to) return null;
	const firstLine = state.doc.lineAt(Math.min(from, state.doc.length)).number;
	const finalPosition = Math.max(from, Math.min(to - 1, state.doc.length));
	const finalLine = state.doc.lineAt(finalPosition).number;
	let firstNonEmpty: number | null = null;
	let lastNonEmpty: number | null = null;
	for (let lineNumber = firstLine; lineNumber <= finalLine; lineNumber += 1) {
		const line = state.doc.line(lineNumber);
		const sliceFrom = Math.max(from, line.from);
		const sliceTo = Math.min(to, line.to);
		if (sliceFrom >= sliceTo || state.doc.sliceString(sliceFrom, sliceTo).trim().length === 0) {
			continue;
		}
		firstNonEmpty ??= line.from;
		lastNonEmpty = line.to;
	}
	return firstNonEmpty === null || lastNonEmpty === null
		? null
		: { from: firstNonEmpty, kind: boundary.kind, to: lastNonEmpty };
}

function splitBoundariesAtSeparatorlessLiterals(
	state: EditorState,
	boundaries: readonly TopLevelBlockBoundary[],
	within?: readonly ParagraphGap[],
): readonly TopLevelBlockBoundary[] {
	const literals = separatorlessListLiteralLines(state, within);
	if (literals.length === 0) return boundaries;
	const sortedBoundaries = [...boundaries]
		.sort((left, right) => left.from - right.from || left.to - right.to);
	const split: TopLevelBlockBoundary[] = [];
	let literalIndex = 0;
	for (const boundary of sortedBoundaries) {
		while (literalIndex < literals.length && literals[literalIndex]!.to <= boundary.from) {
			split.push(literals[literalIndex]!);
			literalIndex += 1;
		}
		let cursor = boundary.from;
		let didSplit = false;
		while (literalIndex < literals.length && literals[literalIndex]!.from < boundary.to) {
			const literal = literals[literalIndex]!;
			if (literal.from < boundary.from || literal.to > boundary.to) {
				throw new Error('Separatorless list literal crosses paragraph boundary');
			}
			const before = trimBoundarySegment(state, boundary, cursor, literal.from);
			if (before) split.push(before);
			split.push(literal);
			cursor = literal.to;
			literalIndex += 1;
			didSplit = true;
		}
		if (didSplit) {
			const after = trimBoundarySegment(state, boundary, cursor, boundary.to);
			if (after) split.push(after);
		} else {
			split.push(boundary);
		}
	}
	while (literalIndex < literals.length) {
		split.push(literals[literalIndex]!);
		literalIndex += 1;
	}
	return split;
}

function lastNonEmptyLineTo(
	state: EditorState,
	fromLine: number,
	toLine: number,
): number {
	for (let lineNumber = toLine; lineNumber >= fromLine; lineNumber -= 1) {
		const line = state.doc.line(lineNumber);
		if (line.text.trim().length > 0) return line.to;
	}
	throw new Error('HyperMD list boundary has no non-empty source line');
}

function hypermdListBoundaries(state: EditorState): readonly TopLevelBlockBoundary[] {
	const topLevelStarts = new Set<number>();
	const listLines = new Set<number>();
	syntaxTree(state).iterate({
		enter: (node) => {
			if (!isObsidianListLineName(node.name)) return;
			const tokens = nodeNameTokens(node.name);
			if (tokens.some((token) => token.startsWith('HyperMD-quote'))) return;
			const line = state.doc.lineAt(node.from);
			listLines.add(line.number);
			if (hypermdListLevel(node.name) === 1 &&
				!tokens.includes('HyperMD-list-line-nobullet')) {
				topLevelStarts.add(line.from);
			}
		},
	});
	const items = enumerateListItems(state)
		.filter((item) => topLevelStarts.has(item.markerLine.from))
		.sort((left, right) => left.markerLine.from - right.markerLine.from);
	if (items.length === 0) return [];
	const components: HypermdLineEnvelope[] = [];
	let openFromLine: number | null = null;
	let lastListLine = 0;
	for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
		if (listLines.has(lineNumber)) {
			openFromLine ??= lineNumber;
			lastListLine = lineNumber;
			continue;
		}
		if (openFromLine !== null && state.doc.line(lineNumber).text.trim().length > 0) {
			components.push({ fromLine: openFromLine, toLine: lastListLine });
			openFromLine = null;
		}
	}
	if (openFromLine !== null) {
		components.push({ fromLine: openFromLine, toLine: lastListLine });
	}
	const boundaries: TopLevelBlockBoundary[] = [];
	let itemIndex = 0;
	for (const component of components) {
		while (itemIndex < items.length &&
			state.doc.lineAt(items[itemIndex]!.markerLine.from).number < component.fromLine) {
			itemIndex += 1;
		}
		const componentItems = [];
		while (itemIndex < items.length) {
			const item = items[itemIndex]!;
			if (state.doc.lineAt(item.markerLine.from).number > component.toLine) break;
			componentItems.push(item);
			itemIndex += 1;
		}
		for (let index = 0; index < componentItems.length; index += 1) {
			const item = componentItems[index]!;
			const startLine = state.doc.lineAt(item.markerLine.from);
			const next = componentItems[index + 1];
			const finalLine = next
				? state.doc.lineAt(next.markerLine.from).number - 1
				: component.toLine;
			boundaries.push({
				from: startLine.from,
				kind: 'list-item',
				to: lastNonEmptyLineTo(state, startLine.number, finalLine),
			});
		}
	}
	return boundaries;
}

function hypermdHeadingBoundaries(state: EditorState): readonly TopLevelBlockBoundary[] {
	const boundaries = new Map<number, TopLevelBlockBoundary>();
	syntaxTree(state).iterate({
		enter: (node) => {
			if (!isHypermdHeadingName(node.name)) return;
			const line = state.doc.lineAt(node.from);
			boundaries.set(line.from, { from: line.from, kind: 'heading', to: line.to });
		},
	});
	return [...boundaries.values()];
}

function atxHeadingFromLine(
	state: EditorState,
	from: number,
	to: number,
	level: number,
): AtxHeadingBlock | null {
	if (level < 1 || level > 6) return null;
	const line = state.doc.lineAt(from);
	if (line.from !== from || line.to !== to) return null;
	const prefix = /^(#{1,6})(?:[ \t]+|$)/u.exec(line.text);
	if (!prefix || prefix[1]!.length !== level) return null;
	const contentFrom = line.from + prefix[0].length;
	if (state.sliceDoc(contentFrom, line.to).trim().length === 0) return null;
	return {
		contentFrom,
		from: line.from,
		level: level as AtxHeadingBlock['level'],
		prefixFrom: line.from,
		prefixTo: line.from + prefix[0].length,
		to: line.to,
	};
}

export function discoverAtxHeadings(state: EditorState): readonly AtxHeadingBlock[] {
	if (!syntaxTreeAvailable(state, state.doc.length)) return [];
	const headings = new Map<number, AtxHeadingBlock>();
	if (!isHypermdState(state)) {
		for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
			const match = /^ATXHeading([1-6])$/u.exec(node.name);
			if (!match) continue;
			const heading = atxHeadingFromLine(state, node.from, node.to, Number(match[1]));
			if (heading) headings.set(heading.from, heading);
		}
		return [...headings.values()];
	}
	syntaxTree(state).iterate({
		enter: (node) => {
			if (!isHypermdHeadingName(node.name)) return;
			const level = nodeNameTokens(node.name)
				.map((token) => /^HyperMD-header-([1-6])$/u.exec(token)?.[1])
				.find((candidate) => candidate !== undefined);
			if (!level) return;
			const line = state.doc.lineAt(node.from);
			const heading = atxHeadingFromLine(state, line.from, line.to, Number(level));
			if (heading) headings.set(heading.from, heading);
		},
	});
	return [...headings.values()].sort((left, right) => left.from - right.from);
}

function validateBoundaryBlocks(
	boundaries: readonly TopLevelBlockBoundary[],
): readonly TopLevelBlockBoundary[] {
	const sorted = [...boundaries].sort((left, right) => left.from - right.from || left.to - right.to);
	for (let index = 1; index < sorted.length; index += 1) {
		if (sorted[index - 1]!.to > sorted[index]!.from) {
			throw new Error('Conflicting complete paragraph gap-boundary ownership');
		}
	}
	return sorted;
}

function boundaryNeighborhood(
	boundaries: readonly TopLevelBlockBoundary[],
	ranges: readonly ParagraphGap[],
): readonly TopLevelBlockBoundary[] {
	const selected = new Set<number>();
	for (const range of ranges) {
		let firstAfter = boundaries.findIndex((boundary) => boundary.to >= range.from);
		if (firstAfter < 0) firstAfter = boundaries.length;
		for (let index = Math.max(0, firstAfter - 1); index < boundaries.length; index += 1) {
			const boundary = boundaries[index]!;
			if (boundary.from > range.to) {
				selected.add(index);
				break;
			}
			selected.add(index);
		}
	}
	return [...selected].sort((left, right) => left - right).map((index) => boundaries[index]!);
}

function topLevelBoundaries(
	state: EditorState,
	within?: readonly ParagraphGap[],
): readonly TopLevelBlockBoundary[] {
	if (!isHypermdState(state)) {
		const nodes = within === undefined
			? (() => {
				const result: SyntaxNode[] = [];
				for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
					result.push(node);
				}
				return result;
			})()
			: topLevelNodesAround(state, within);
		return standardBoundariesForNodes(state, nodes, within === undefined);
	}
	const all = validateBoundaryBlocks(splitBoundariesAtSeparatorlessLiterals(state, [
		...hypermdParagraphs(state),
		...hypermdHeadingBoundaries(state),
		...hypermdListBoundaries(state),
		...hypermdComplexBoundaries(state),
	]));
	return within === undefined ? all : boundaryNeighborhood(all, within);
}

function standardBoundariesForNodes(
	state: EditorState,
	nodes: readonly SyntaxNode[],
	completeDocument: boolean,
): readonly TopLevelBlockBoundary[] {
	return validateBoundaryBlocks(splitBoundariesAtSeparatorlessLiterals(
		state,
		standardBoundaryBlocks(nodes),
		completeDocument
			? undefined
			: nodes.map((node) => ({ from: node.from, to: node.to })),
	));
}

function addNodeNeighborhood(
	nodes: Map<string, SyntaxNode>,
	node: SyntaxNode | null,
): void {
	for (const candidate of [node?.prevSibling, node, node?.nextSibling]) {
		if (!candidate) continue;
		nodes.set(`${candidate.from}:${candidate.to}:${candidate.name}`, candidate);
	}
}

function topLevelNodesAround(
	state: EditorState,
	ranges: readonly ParagraphGap[],
): readonly SyntaxNode[] {
	const top = syntaxTree(state).topNode;
	const nodes = new Map<string, SyntaxNode>();
	for (const range of ranges) {
		const from = Math.max(0, Math.min(range.from, state.doc.length));
		const to = Math.max(from, Math.min(range.to, state.doc.length));
		addNodeNeighborhood(nodes, top.childBefore(from));
		addNodeNeighborhood(nodes, top.childAfter(from));
		addNodeNeighborhood(nodes, top.childBefore(to));
		addNodeNeighborhood(nodes, top.childAfter(to));
		for (let node = top.childAfter(from); node && node.from <= to; node = node.nextSibling) {
			addNodeNeighborhood(nodes, node);
		}
	}
	return [...nodes.values()]
		.sort((left, right) => left.from - right.from || left.to - right.to);
}

function internalAnchors(from: number, newlineCount: number): readonly number[] {
	return Array.from(
		{ length: Math.max(0, Math.floor(newlineCount / 2) - 1) },
		(_, index) => from + 2 * (index + 1),
	);
}

function gapsBetween(
	from: number,
	to: number,
	anchors: readonly number[],
): readonly ParagraphGap[] {
	const boundaries = [from, ...anchors, to];
	return boundaries.slice(0, -1).map((start, index) => ({
		from: start,
		to: boundaries[index + 1]!,
	}));
}

function middleRows(from: number, newlineCount: number): readonly ParagraphPhysicalRow[] {
	return Array.from({ length: newlineCount - 1 }, (_, index) => {
		const row = index + 1;
		const folded = newlineCount % 2 === 1 && row === newlineCount - 1;
		return {
			at: from + row,
			kind: folded ? 'folded' : row % 2 === 1 ? 'gap-head' : 'editable',
		};
	});
}

function paragraphRun(
	kind: ParagraphRun['kind'],
	from: number,
	to: number,
): ParagraphRun {
	if (kind === 'leading') {
		return {
			kind,
			from,
			to,
			gaps: [{ from, to }],
			editableAnchors: [],
			rows: Array.from({ length: to - from }, (_, index) => ({
				at: from + index,
				kind: index === 0 ? 'gap-head' : 'folded',
			})),
		};
	}
	const anchors = internalAnchors(from, to - from);
	const trailing = kind === 'trailing';
	return {
		kind,
		from,
		to,
		gaps: gapsBetween(from, to, anchors),
		editableAnchors: trailing ? [...anchors, to] : anchors,
		rows: trailing
			? [...middleRows(from, to - from), { at: to, kind: 'editable' }]
			: middleRows(from, to - from),
	};
}

function eligibleRun(
	state: EditorState,
	kind: ParagraphRun['kind'],
	from: number,
	to: number,
): ParagraphRun | null {
	return newlineRunPattern.test(state.doc.sliceString(from, to))
		? paragraphRun(kind, from, to)
		: null;
}

function discoverRuns(
	state: EditorState,
	paragraphs: readonly ParagraphBlock[],
	boundaries: readonly ParagraphBlock[],
): readonly ParagraphRun[] {
	const runs: ParagraphRun[] = [];
	const firstParagraph = paragraphs[0];
	const leading = firstParagraph
		? eligibleRun(state, 'leading', 0, firstParagraph.from)
		: null;
	if (leading) runs.push(leading);
	for (let index = 1; index < boundaries.length; index += 1) {
		const left = boundaries[index - 1]!;
		const right = boundaries[index]!;
		const middle = eligibleRun(state, 'middle', left.to, right.from);
		if (middle) runs.push(middle);
	}
	const lastParagraph = paragraphs.at(-1);
	const trailing = lastParagraph
		? eligibleRun(state, 'trailing', lastParagraph.to, state.doc.length)
		: null;
	if (trailing) runs.push(trailing);
	return runs;
}

function authorityFromBlocks(
	state: EditorState,
	blocks: readonly TopLevelBlockBoundary[],
): ParagraphAuthority {
	const boundaries = blocks
		.filter(({ kind }) => capabilitiesForTopLevelBlock(kind).gapBoundary)
		.map(({ from, to }) => ({ from, to }));
	const paragraphs = blocks
		.filter(({ kind }) => capabilitiesForTopLevelBlock(kind).paragraphEnter)
		.map(({ from, to }) => ({ from, to }));
	return {
		blocks,
		boundaries,
		complete: true,
		paragraphs,
		runs: discoverRuns(state, paragraphs, boundaries),
	};
}

export function discoverParagraphAuthority(
	state: EditorState,
	within?: readonly ParagraphGap[],
): ParagraphAuthority {
	if (!syntaxTreeAvailable(state, state.doc.length)) {
		return { blocks: [], boundaries: [], complete: false, paragraphs: [], runs: [] };
	}
	return authorityFromBlocks(state, topLevelBoundaries(state, within));
}

export function discoverParagraphAuthorityWithin(
	state: EditorState,
	ranges: readonly ParagraphGap[],
): ParagraphAuthoritySlice {
	if (!syntaxTreeAvailable(state, state.doc.length)) {
		return {
			authority: { blocks: [], boundaries: [], complete: false, paragraphs: [], runs: [] },
			coveredRanges: [],
		};
	}
	const hypermd = isHypermdState(state) ? hypermdAuthoritySlice(state, ranges) : null;
	const nodes = hypermd ? [] : topLevelNodesAround(state, ranges);
	const coveredRanges = hypermd?.coveredRanges ??
		nodes.map((node) => ({ from: node.from, to: node.to }));
	const blocks = hypermd
		? topLevelBoundaries(state, coveredRanges)
		: standardBoundariesForNodes(state, nodes, false);
	return {
		authority: authorityFromBlocks(state, blocks),
		coveredRanges,
	};
}

export function verticalEntryRange(
	state: EditorState,
	block: TopLevelBlockBoundary,
	forward: boolean,
): ParagraphBlock | null {
	if (block.kind === 'blockquote') {
		const line = state.doc.lineAt(forward ? block.from : Math.max(block.from, block.to - 1));
		const quotePrefix = /^(?:[ \t]*>[ \t]?)+/u.exec(line.text)?.[0] ?? '';
		const quotedContent = line.text.slice(quotePrefix.length);
		const calloutPrefix = forward
			? /^\[![^\]\r\n]+\][+-]?[ \t]*/u.exec(quotedContent)?.[0] ?? ''
			: '';
		return {
			from: line.from + quotePrefix.length + calloutPrefix.length,
			to: line.to,
		};
	}
	if (block.kind === 'code-block') {
		const first = state.doc.lineAt(block.from);
		const last = state.doc.lineAt(Math.max(block.from, block.to - 1));
		if (first.number === last.number) return null;
		if (forward) {
			const next = state.doc.line(first.number + 1);
			if (next.number === last.number &&
				/^[ \t]*(?:`{3,}|~{3,})[ \t]*$/u.test(next.text)) return null;
			return { from: next.from, to: next.to };
		}
		if (/^[ \t]*(?:`{3,}|~{3,})[ \t]*$/u.test(last.text)) {
			if (last.number <= first.number + 1) return null;
			const previous = state.doc.line(last.number - 1);
			return { from: previous.from, to: previous.to };
		}
		return { from: last.from, to: last.to };
	}
	return block;
}

interface ParagraphPath {
	readonly paragraph: ParagraphBlock | null;
	readonly hasNamedDescendant: boolean;
}

function paragraphPath(node: SyntaxNode): ParagraphPath {
	let hasNamedDescendant = false;
	for (let current: SyntaxNode | null = node; current; current = current.parent) {
		if (current.name === 'Paragraph' && current.parent?.parent === null) {
			return {
				paragraph: { from: current.from, to: current.to },
				hasNamedDescendant,
			};
		}
		if (!current.type.isAnonymous) hasNamedDescendant = true;
	}
	return { paragraph: null, hasNamedDescendant: false };
}

export function ordinaryParagraphAtCaret(
	state: EditorState,
	position: number,
	knownParagraphs?: readonly ParagraphBlock[],
): ParagraphBlock | null {
	if (position < 0 || position > state.doc.length) {
		throw new RangeError('Caret position is outside the document');
	}
	if (!syntaxTreeAvailable(state, state.doc.length)) return null;
	const tree = syntaxTree(state);
	if (isHypermdState(state)) {
		const paragraph = (knownParagraphs ?? hypermdParagraphs(state))
			.find((candidate) => candidate.from <= position && position <= candidate.to) ?? null;
		if (!paragraph) return null;
		for (const side of [-1, 1] as const) {
			if ((side < 0 && position === 0) ||
				(side > 0 && position === state.doc.length)) continue;
			for (
				let current: SyntaxNode | null = tree.resolveInner(position, side);
				current?.parent;
				current = current.parent
			) {
				if (!current.type.isAnonymous) return null;
			}
		}
		return { from: paragraph.from, to: paragraph.to };
	}
	const paths: ParagraphPath[] = [];
	if (position > 0) paths.push(paragraphPath(tree.resolveInner(position, -1)));
	if (position < state.doc.length) paths.push(paragraphPath(tree.resolveInner(position, 1)));
	if (paths.some((path) => path.hasNamedDescendant)) return null;
	return paths.find((path) => path.paragraph !== null)?.paragraph ?? null;
}
