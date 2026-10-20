import { language, syntaxTree as nativeSyntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { mathSyntaxTree as syntaxTree } from '../math/semantic-tree.js';
import type { EditorState, Text } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { GFM, parser as markdownParser } from '@lezer/markdown';
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
import { isSeparatorlessListMarkerLine, markdownColumns, prefixPolicy } from '../structured-list/prefix.js';
import { enumerateListItems, isObsidianListLineName, listParagraphContinuations } from '../structured-list/syntax.js';
import { standaloneMediaKind } from './media.js';
import { htmlBlockExtents } from '../table/html-table-range.js';
import { emptyBodies } from '../runtime/empty-body-state.js';
import { pendingMathAt, pendingMathRanges, type PendingMathRange } from '../math/candidate-ranges.js';
import { codeDraft } from '../code-blocks/draft-state.js';
import { discoverSetextHeadings } from './setext.js';
import { standaloneBreakGrammar } from '../markdown-grammar.js';

const newlineRunPattern = /^\n{2,}$/u;

/** CM may finish only a viewport. Query coverage, never infer it from tree.length. */
export function confirmedSyntaxEnd(state: EditorState): number {
	let from = 0, to = state.doc.length;
	if (syntaxTreeAvailable(state, to)) return to;
	while (from < to) {
		const middle = Math.ceil((from + to) / 2);
		if (syntaxTreeAvailable(state, middle)) from = middle;
		else to = middle - 1;
	}
	return from;
}

function confirmedBlocks(state: EditorState, blocks: readonly TopLevelBlockBoundary[]): readonly TopLevelBlockBoundary[] {
	const end = confirmedSyntaxEnd(state);
	if (end === state.doc.length) return blocks;
	return blocks.filter(block => {
		const last = state.doc.lineAt(block.to);
		// The following complete line establishes that this block did not stop
		// only because parsing stopped (paragraph/list/quote/code continuation).
		return last.number < state.doc.lines && state.doc.line(last.number + 1).to <= end;
	});
}

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
	const isHtmlToken = node.name === 'HTMLTag' || nodeNameTokens(node.name).some((token) =>
		token === 'hmd-html-begin' || token === 'hmd-html-end');
	if (!isHtmlToken) return null;
	const source = state.doc.sliceString(node.from, node.to);
	if (/^<br\s*\/?\s*>$/iu.test(source)) return { from: node.from, to: node.to };

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
	if (!isHypermdBlockNode(node) || inlineHtmlBreakRangeForNode(state, node)) return false;
	const tokens = nodeNameTokens(node.name);
	if (tokens.some(token => token === 'math' || token === 'math-block') && pendingMathAt(state, node.from, node.to)) return false;
	if (tokens.some(token => token.startsWith('HyperMD-'))) return true;
	if (tokens.includes('hmd-html-begin') || tokens.includes('hmd-html-end')) {
		return htmlGrammarBoundaries(state).some(block => block.from <= node.from && node.to <= block.to);
	}
	return true;
}

const htmlBoundaryCache = new WeakMap<Text, { readonly end: number; readonly blocks: readonly TopLevelBlockBoundary[] }>();
export const htmlBoundaryGrammar=markdownParser.configure(standaloneBreakGrammar);

/** HyperMD HTML tokens identify tags, not block boundaries. Admit only grammar-confirmed HTML blocks. */
function htmlGrammarBoundaries(state: EditorState): readonly TopLevelBlockBoundary[] {
	const end = confirmedSyntaxEnd(state);
	const cached = htmlBoundaryCache.get(state.doc);
	if (cached?.end === end) return cached.blocks;
	const blocks: TopLevelBlockBoundary[] = [];
	const source=state.sliceDoc(0, end),tree = htmlBoundaryGrammar.parse(source);
	let extents:ReturnType<typeof htmlBlockExtents>|undefined;
	let consumed=0;
	for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
		if(node.from<consumed||node.name!=='HTMLBlock')continue;
		const tag=/^<([A-Za-z][\w-]*)(?:\s|>)/u.exec(source.slice(node.from,node.to))?.[1]?.toLowerCase();
		const extent=tag?(extents??=htmlBlockExtents(source)).get(node.from):null;
		if(extent){
			let ending=tree.resolveInner(extent.to,-1);while(ending.parent?.parent)ending=ending.parent;
			if(!source.slice(extent.to,ending.to).trim()){
				blocks.push({from:node.from,to:ending.to,kind:tag==='table'&&!extent.nested?'table':'html-block'});consumed=ending.to;continue;
			}
		}
		blocks.push({ from: node.from, to: node.to, kind: 'html-block' });
	}
	htmlBoundaryCache.set(state.doc, {end, blocks});
	return blocks;
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
	// Shared math tokens do not change the underlying Markdown parser's identity.
	nativeSyntaxTree(state).iterate({
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
	const admittedHtml = new Set<number>();
	syntaxTree(state).iterate({
		enter: (node) => {
			const tokens = nodeNameTokens(node.name);
			const inlineHtmlBreak = inlineHtmlBreakRangeForNode(state, node.node);
			if (tokens.some(token => token === 'math' || token === 'math-block') && pendingMathAt(state, node.from, node.to)) return;
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
				const block = htmlGrammarBoundaries(state).find(block => block.from === node.from);
				if (block && !admittedHtml.has(block.from)) {
					boundaries.push(block);
					admittedHtml.add(block.from);
				}
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
	if (tokens.includes('HyperMD-footnote')) return 'HyperMD-footnote';
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
	const end = confirmedSyntaxEnd(state);
	for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
		const line = state.doc.line(lineNumber);
		if (line.to > end) break;
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

function standardBoundaryBlocks(state:EditorState,nodes: readonly SyntaxNode[]): readonly TopLevelBlockBoundary[] {
	const boundaries: TopLevelBlockBoundary[] = [];
	const htmlBlocks=htmlGrammarBoundaries(state);
	const mathBlocks=hypermdDelimitedBoundaries(state).filter(block=>block.kind==='math-block');
	const included=new Set<TopLevelBlockBoundary>();
	let htmlIndex=0;
	for (const node of nodes) {
		while(htmlIndex<htmlBlocks.length&&htmlBlocks[htmlIndex]!.to<=node.from)htmlIndex++;
		const html=htmlBlocks[htmlIndex];
		if(html&&html.from<=node.from&&node.to<=html.to){if(!included.has(html)){boundaries.push(html);included.add(html);}continue;}
		const math=mathBlocks.find(block=>block.from<=node.from&&node.to<=block.to);
		if(math){if(!included.has(math)){boundaries.push(math);included.add(math);}continue;}
		if (node.name === 'Paragraph') {
			let from=node.from;
			for(const math of mathBlocks.filter(block=>node.from<=block.from&&block.to<=node.to)) {
				const before=state.sliceDoc(from,math.from).trimEnd();
				if(before)boundaries.push({from,kind:'paragraph',to:from+before.length});
				boundaries.push(math);from=math.to;
				while(from<node.to&&state.sliceDoc(from,from+1)==='\n')from++;
			}
			if(from<node.to)boundaries.push({ from, kind: 'paragraph', to: node.to });
			continue;
		}
		if (/^(?:ATXHeading[1-6]|SetextHeading[12])$/u.test(node.name)) {
			boundaries.push({ from: node.from, kind: 'heading', headingLevel: Number(node.name.at(-1)) as AtxHeadingBlock['level'], to: node.to });
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
		const items = enumerateListItems(state, [{from:node.from,to:node.to}]);
		for (const item of items.filter(item => !items.some(parent => parent.itemNode.from < item.itemNode.from && parent.itemNode.to >= item.itemNode.to))) {
			boundaries.push({from:state.doc.lineAt(item.markerLine.from).from,kind:'list-item',to:item.itemNode.to});
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

function hypermdComplexBoundaries(
	state: EditorState,
	containers: readonly TopLevelBlockBoundary[],
): readonly TopLevelBlockBoundary[] {
	const containedLines = new Set<number>();
	for (const container of containers) {
		const last = state.doc.lineAt(container.to).number;
		for (let number = state.doc.lineAt(container.from).number; number <= last; number += 1) containedLines.add(number);
	}
	const lines = new Map<number, TopLevelBlockBoundaryKind>();
	const explicitStarts = new Set<number>();
	const explicitEnds = new Set<number>();
	const assign = (fromLine: number, toLine: number, kind: TopLevelBlockBoundaryKind): void => {
		for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
			// Nested code and other blocks stay inside their syntax-confirmed outer container.
			if (containedLines.has(lineNumber)) continue;
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
			const tokens = nodeNameTokens(node.name);
			// Host line tokens omit the final empty row. A confirmed opener owns
			// its fence grammar through EOF, including unfinished internal blanks.
			if (kind === 'code-block' && (tokens.includes('HyperMD-codeblock-begin') ||
				tokens.includes('HyperMD-codeblock') && node.to > state.doc.line(fromLine).to)) {
				const end=tokens.includes('HyperMD-codeblock-begin')?confirmedSyntaxEnd(state):node.to;
				const fence = markdownParser.parse(state.sliceDoc(node.from, end)).topNode.firstChild;
				if (fence?.name === 'FencedCode') {
					const closed = fence.getChildren('CodeMark').length === 2;
					const last = state.doc.lineAt(closed ? node.from + fence.to : end).number;
					explicitStarts.add(fromLine);
					if (closed) explicitEnds.add(last);
					assign(fromLine, last, kind);
					return;
				}
			}
			if (tokens.includes('HyperMD-codeblock-begin')) explicitStarts.add(fromLine);
			if (tokens.includes('HyperMD-codeblock-end')) explicitEnds.add(toLine);
			assign(fromLine, toLine, kind);
		},
	});
	for (const boundary of hypermdDelimitedBoundaries(state)) {
		explicitStarts.add(state.doc.lineAt(boundary.from).number);
		explicitEnds.add(state.doc.lineAt(boundary.to).number);
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
		// Line-token families group interiors, but a proven delimiter edge ends
		// that group even when the immediately adjacent block has the same family.
		if (previous && previous.kind === kind && kind !== 'thematic-break' &&
			!explicitStarts.has(lineNumber) && !explicitEnds.has(state.doc.lineAt(previous.to).number) &&
			state.doc.lineAt(previous.to).number + 1 === lineNumber) {
			boundaries[boundaries.length - 1] = { ...previous, to: line.to };
			continue;
		}
		boundaries.push({ from: line.from, kind, to: line.to });
	}
	return boundaries;
}

function hypermdFootnoteBoundaries(state: EditorState): readonly TopLevelBlockBoundary[] {
	const lines = new Set<number>();
	syntaxTree(state).iterate({ enter: (node) => {
		const tokens = nodeNameTokens(node.name);
		if (!tokens.includes('HyperMD-footnote') || tokens.includes('HyperMD-list-line') ||
			tokens.some(token => token.startsWith('HyperMD-quote'))) return;
		const last = state.doc.lineAt(node.to > node.from ? node.to - 1 : node.to).number;
		for (let number = state.doc.lineAt(node.from).number; number <= last; number += 1) lines.add(number);
	} });
	const boundaries: TopLevelBlockBoundary[] = [];
	let from: number | null = null;
	let to = 0;
	for (let number = 1; number <= state.doc.lines; number += 1) {
		const line = state.doc.line(number);
		if (lines.has(number) && /^ {0,3}\[\^[^\s[\]]+\]:/u.test(line.text)) {
			if (from !== null) boundaries.push({ from, to, kind: 'footnote-definition' });
			from = line.from;
			to = line.to;
		} else if (from !== null && line.text.trim().length > 0) {
			if (lines.has(number)) to = line.to;
			else { boundaries.push({ from, to, kind: 'footnote-definition' }); from = null; }
		}
	}
	if (from !== null) boundaries.push({ from, to, kind: 'footnote-definition' });
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
	const literals = separatorlessListLiteralLines(state, within).filter(literal =>
		!boundaries.some(boundary => {
			if (boundary.kind !== 'list-item' || boundary.from >= literal.from || literal.to > boundary.to) return false;
			const opening = state.doc.lineAt(boundary.from);
			const prefix = prefixPolicy.parse(opening.text, opening.from)!;
			const indent = state.doc.lineAt(literal.from).text.match(/^[ \t]*/u)![0];
			return markdownColumns(indent) >= markdownColumns(prefix.indentText + prefix.markerText + prefix.separatorText);
		}));
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
	const listLines = new Set<number>();
	syntaxTree(state).iterate({
		enter: (node) => {
			if (!isObsidianListLineName(node.name)) return;
			const tokens = nodeNameTokens(node.name);
			if (tokens.some((token) => token.startsWith('HyperMD-quote'))) return;
			const line = state.doc.lineAt(node.from);
			listLines.add(line.number);
		},
	});
	const allItems = enumerateListItems(state);
	const items = allItems
		.filter((item) => !allItems.some(parent => parent.itemNode.from < item.itemNode.from && parent.itemNode.to >= item.itemNode.to))
		.sort((left, right) => left.markerLine.from - right.markerLine.from);
	if (items.length === 0) return [];
	const confirmedOwners = new Map(allItems.map(item => [state.doc.lineAt(item.markerLine.from).number, item]));
	for (const fact of listParagraphContinuations(state)) {
		const owner = confirmedOwners.get(fact.ownerLineNumber);
		const line = state.doc.line(fact.lineNumber);
		if (owner && line.to <= owner.itemNode.to && syntaxTreeAvailable(state, line.to)) listLines.add(fact.lineNumber);
	}
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
				// A source-backed empty continuation is still part of this item.
				to: Math.max(Math.min(item.itemNode.to, state.doc.line(finalLine).to),
					lastNonEmptyLineTo(state, startLine.number, finalLine)),
			});
		}
	}
	return boundaries;
}

function hypermdHeadingBoundaries(state: EditorState): readonly TopLevelBlockBoundary[] {
	const boundaries = new Map<number, TopLevelBlockBoundary>();
	const setext = discoverSetextHeadings(state).filter(heading => heading.topLevel && heading.to <= confirmedSyntaxEnd(state));
	for (const heading of setext) boundaries.set(heading.from, { from: heading.from, to: heading.to, kind: 'heading', headingLevel: heading.level });
	syntaxTree(state).iterate({
		enter: (node) => {
			if (!isHypermdHeadingName(node.name)) return;
			const line = state.doc.lineAt(node.from);
			if (setext.some(heading => heading.from <= line.from && line.to <= heading.to)) return;
			const level = nodeNameTokens(node.name)
				.map(token => /^HyperMD-header-([1-6])$/u.exec(token)?.[1])
				.find(candidate => candidate !== undefined);
			if (level) boundaries.set(line.from, { from: line.from, kind: 'heading', headingLevel: Number(level) as AtxHeadingBlock['level'], to: line.to });
		},
	});
	return [...boundaries.values()];
}

export interface HeadingBodyLine {
	readonly from: number;
	readonly to: number;
	readonly bodyFrom: number;
}

function atxHeadingFromLine(
	state: EditorState,
	from: number,
	to: number,
	level: number,
	bodyFrom = from,
): AtxHeadingBlock | null {
	if (level < 1 || level > 6) return null;
	const line = state.doc.lineAt(from);
	if (line.from !== from || line.to !== to) return null;
	const prefix = /^(#{1,6})(?:[ \t]+|$)/u.exec(state.sliceDoc(bodyFrom, to));
	if (!prefix || prefix[1]!.length !== level) return null;
	const contentFrom = bodyFrom + prefix[0].length;
	if (contentFrom === bodyFrom + level) return null;
	return {
		contentFrom,
		from: line.from,
		level: level as AtxHeadingBlock['level'],
		prefixFrom: bodyFrom,
		prefixTo: bodyFrom + prefix[0].length,
		to: line.to,
	};
}

export function discoverAtxHeadings(state: EditorState, bodyLines: readonly HeadingBodyLine[] = []): readonly AtxHeadingBlock[] {
	const end = confirmedSyntaxEnd(state);
	const headings = new Map<number, AtxHeadingBlock>();
	for (const line of bodyLines) {
		if (line.to > end) continue;
		const prefix = /^(#{1,6})(?:[ \t]+|$)/u.exec(state.sliceDoc(line.bodyFrom, line.to));
		if (!prefix) continue;
		const heading = atxHeadingFromLine(state, line.from, line.to, prefix[1]!.length, line.bodyFrom);
		if (heading) headings.set(heading.from, heading);
	}
	if (!isHypermdState(state)) {
		for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
			const match = /^ATXHeading([1-6])$/u.exec(node.name);
			if (!match || state.doc.lineAt(node.from).to > end) continue;
			const heading = atxHeadingFromLine(state, node.from, node.to, Number(match[1]));
			if (heading) headings.set(heading.from, heading);
		}
		return [...headings.values()].sort((left, right) => left.from - right.from);
	}
	syntaxTree(state).iterate({
		enter: (node) => {
			if (!isHypermdHeadingName(node.name)) return;
			const level = nodeNameTokens(node.name)
				.map((token) => /^HyperMD-header-([1-6])$/u.exec(token)?.[1])
				.find((candidate) => candidate !== undefined);
			if (!level) return;
			const line = state.doc.lineAt(node.from);
			if (line.to > end) return;
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
			const previous = sorted[index - 1]!;
			const current = sorted[index]!;
			throw new Error(`Conflicting complete paragraph gap-boundary ownership: ${previous.kind} ${previous.from}:${previous.to}, ${current.kind} ${current.from}:${current.to}`);
		}
	}
	return sorted;
}

function classifyMediaBlocks(state: EditorState, blocks: readonly TopLevelBlockBoundary[]): readonly TopLevelBlockBoundary[] {
	return blocks.map(block => block.kind === 'paragraph' &&
		standaloneMediaKind(state.sliceDoc(block.from, block.to)) === 'image'
		? { ...block, kind: 'media' } : block);
}

function admitEmptyBodies(
	state: EditorState,
	blocks: readonly TopLevelBlockBoundary[],
	from: number,
	to: number,
): readonly TopLevelBlockBoundary[] {
	const admitted = [...blocks];
	const emptyDocument = /^[ \t\n]*$/u.test(state.sliceDoc());
	const confirmedTo = confirmedSyntaxEnd(state);
	for (let number = state.doc.lineAt(from).number; number <= state.doc.lineAt(to).number; number += 1) {
		const line = state.doc.line(number);
		if (line.to > confirmedTo || !/^[ \t]*$/u.test(line.text)) continue;
		if (!line.text.length && !(emptyDocument && (number === 1 || number === state.doc.lines))) continue;
		if (blocks.some(block => block.from <= line.from && line.to <= block.to)) continue;
		admitted.push({ from: line.from, to: line.to, kind: 'paragraph' });
	}
	return validateBoundaryBlocks(admitted);
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
		const blocks = standardBoundariesForNodes(state, nodes, within === undefined);
		return adjustCodeDraftBoundaries(state, adjustPendingMathBoundaries(state, blocks), within);
	}
	const containers = [...hypermdListBoundaries(state), ...hypermdFootnoteBoundaries(state)];
	const headings = hypermdHeadingBoundaries(state);
	const all = admitEmptyBodies(state, confirmedBlocks(state, classifyMediaBlocks(state, splitBoundariesAtSeparatorlessLiterals(state, [
		...hypermdParagraphs(state).filter(paragraph => !containers.some(container =>
			container.from <= paragraph.from && paragraph.to <= container.to) && !headings.some(heading =>
			heading.from <= paragraph.from && paragraph.to <= heading.to)),
		...headings,
		...containers,
		...hypermdComplexBoundaries(state, containers).filter(block => !headings.some(heading => heading.from <= block.from && block.to <= heading.to)),
	]))), 0, state.doc.length);
	return adjustCodeDraftBoundaries(state, adjustPendingMathBoundaries(state, all), within);
}

const pendingMathTrees = new WeakMap<Text, { ranges: readonly PendingMathRange[]; tree: Tree }>();
function pendingMathOrdinaryTree(state: EditorState): Tree {
	const ranges = pendingMathRanges(state), cached = pendingMathTrees.get(state.doc);
	if (cached?.ranges === ranges) return cached.tree;
	const source = state.sliceDoc().split('');
	const bounds = pendingMathRanges(state).map(range => ({ from: state.doc.lineAt(range.from).from, to: range.to }));
	// Mask other blocks so ordinary grammar cannot merge a pending row into a confirmed formula.
	for (let pos = 0; pos < source.length; pos++) {
		if (source[pos] !== '\n' && !bounds.some(range => range.from <= pos && pos < range.to)) source[pos] = ' ';
	}
	const tree = draftParser.parse(source.join(''));
	pendingMathTrees.set(state.doc, { ranges, tree });
	return tree;
}

function adjustPendingMathBoundaries(state: EditorState, blocks: readonly TopLevelBlockBoundary[]): readonly TopLevelBlockBoundary[] {
	if (!pendingMathRanges(state).length) return blocks;
	const nodes: SyntaxNode[] = [], items: TopLevelBlockBoundary[] = [];
	for (let node = pendingMathOrdinaryTree(state).topNode.firstChild; node; node = node.nextSibling) {
		if (node.name === 'BulletList' || node.name === 'OrderedList') {
			for (let item = node.firstChild; item; item = item.nextSibling) {
				if (item.name === 'ListItem') items.push({ from: item.from, to: item.to, kind: 'list-item' });
			}
		} else nodes.push(node);
	}
	// Reclassify pending bodies without replacing their enclosing container.
	const ordinary = [...standardBoundaryBlocks(state, nodes), ...items].filter(next =>
		!blocks.some(block => (block.kind === 'blockquote' || block.kind === 'list-item') &&
			block.from <= next.from && next.to <= block.to));
	return validateBoundaryBlocks([...blocks.filter(block => !ordinary.some(next => next.from < block.to && block.from < next.to)), ...ordinary]);
}
const draftParser = markdownParser.configure(GFM);
const draftBoundaryCache = new WeakMap<Text, { from: number; blocks: readonly TopLevelBlockBoundary[] }>();

/** A newly typed fence is a pending opening line, not the owner of the source after it. */
function adjustCodeDraftBoundaries(
	state: EditorState,
	blocks: readonly TopLevelBlockBoundary[],
	within?: readonly ParagraphGap[],
): readonly TopLevelBlockBoundary[] {
	const draft = state.facet(codeDraft);
	if (!draft || blocks.some(block => block.from < draft.from && draft.to <= block.to &&
		(block.kind === 'blockquote' || block.kind === 'list-item'))) {
		return within === undefined ? blocks : boundaryNeighborhood(blocks, within);
	}
	let parsed = draftBoundaryCache.get(state.doc);
	if (parsed?.from !== draft.from) {
		// Preserve offsets and container syntax while removing only the pending opener from grammar input.
		const source = state.sliceDoc(0, draft.from) + ' '.repeat(draft.to - draft.from) + state.sliceDoc(draft.to);
		const suffix: TopLevelBlockBoundary[] = [];
		const append = (node: SyntaxNode): void => {
			const level = /^(?:ATXHeading|SetextHeading)([1-6])$/u.exec(node.name)?.[1];
			const kind: TopLevelBlockBoundaryKind | undefined = level ? 'heading' : {
				Paragraph: 'paragraph', Blockquote: 'blockquote', FencedCode: 'code-block', CodeBlock: 'code-block',
				Table: 'table', HorizontalRule: 'thematic-break', HTMLBlock: 'html-block', ListItem: 'list-item',
			}[node.name] as TopLevelBlockBoundaryKind | undefined;
			if (kind) suffix.push({ from: node.from, to: node.to, kind,
				...(level ? { headingLevel: Number(level) as AtxHeadingBlock['level'] } : {}) });
		};
		for (let node = draftParser.parse(source).topNode.firstChild; node; node = node.nextSibling) {
			if (node.from <= draft.to || node.to > draft.end) continue;
			if (node.name === 'BulletList' || node.name === 'OrderedList') {
				for (let item = node.firstChild; item; item = item.nextSibling) if (item.name === 'ListItem') append(item);
			} else append(node);
		}
		parsed = { from: draft.from, blocks: suffix };
		draftBoundaryCache.set(state.doc, parsed);
	}
	const adjusted = admitEmptyBodies(state, confirmedBlocks(state, [
		...blocks.filter(block => block.to < draft.from || block.from > draft.end),
		{ from: draft.from, to: draft.to, kind: 'paragraph' },
		...parsed.blocks,
	]), draft.from, draft.end);
	return within === undefined ? adjusted : boundaryNeighborhood(adjusted, within);
}

function standardBoundariesForNodes(
	state: EditorState,
	nodes: readonly SyntaxNode[],
	completeDocument: boolean,
): readonly TopLevelBlockBoundary[] {
	const blocks = confirmedBlocks(state, classifyMediaBlocks(state, splitBoundariesAtSeparatorlessLiterals(
		state,
		standardBoundaryBlocks(state,nodes),
		completeDocument
			? undefined
			: nodes.map((node) => ({ from: node.from, to: node.to })),
	)));
	const first = nodes[0], last = nodes.at(-1);
	return admitEmptyBodies(state, blocks,
		first?.prevSibling ? first.from : 0,
		last?.nextSibling ? last.to : state.doc.length);
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
		const anchors = [from, ...internalAnchors(from, to - from)];
		return {
			kind,
			from,
			to,
			gaps: gapsBetween(from, to, anchors.slice(1)),
			editableAnchors: anchors,
			rows: [{ at: from, kind: 'editable' }, ...middleRows(from, to - from)],
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
	if (kind === 'leading' && state.doc.sliceString(from, to) === '\n') {
		const editable = emptyBodies(state).includes(from);
		return {kind,from,to,gaps:[{from,to}],editableAnchors:editable?[from]:[],rows:[{at:from,kind:editable?'editable':'folded'}]};
	}
	if (kind === 'trailing' && state.doc.sliceString(from, to) === '\n') {
		return {kind,from,to,gaps:[],editableAnchors:[to],rows:[{at:to,kind:'editable'}]};
	}
	if (!newlineRunPattern.test(state.doc.sliceString(from, to))) return null;
	const run=paragraphRun(kind,from,to);
	const drafts=emptyBodies(state).filter(anchor=>from<anchor&&anchor<to);
	if(!drafts.length)return run;
	const anchors=[...new Set([...run.editableAnchors,...drafts])].sort((a,b)=>a-b);
	const draftRows=new Set(drafts.map(anchor=>state.doc.lineAt(anchor).from));
	return {...run,editableAnchors:anchors,gaps:gapsBetween(from,to,anchors.filter(anchor=>from<anchor&&anchor<to)),
		rows:run.rows.map(row=>draftRows.has(row.at)?{...row,kind:'editable'}:row)};
}

function discoverRuns(
	state: EditorState,
	boundaries: readonly TopLevelBlockBoundary[],
): readonly ParagraphRun[] {
	const runs: ParagraphRun[] = [];
	const firstParagraph = boundaries[0];
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
	const lastParagraph = boundaries.at(-1);
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
		.filter(({ kind }) => capabilitiesForTopLevelBlock(kind).gapBoundary);
	const paragraphs = blocks
		.filter(({ kind }) => capabilitiesForTopLevelBlock(kind).paragraphEnter)
		.map(({ from, to }) => ({ from, to }));
	return {
		blocks,
		boundaries: boundaries.map(({from,to})=>({from,to})),
		complete: syntaxTreeAvailable(state, state.doc.length),
		paragraphs,
		runs: discoverRuns(state, boundaries)
			.filter(run => syntaxTreeAvailable(state, run.to)),
	};
}

export function discoverParagraphAuthority(
	state: EditorState,
	within?: readonly ParagraphGap[],
): ParagraphAuthority {
	return authorityFromBlocks(state, topLevelBoundaries(state, within));
}

export function discoverParagraphAuthorityWithin(
	state: EditorState,
	ranges: readonly ParagraphGap[],
): ParagraphAuthoritySlice {
	if (pendingMathRanges(state).length || !syntaxTreeAvailable(state, state.doc.length)) {
		const authority = discoverParagraphAuthority(state, ranges);
		return {
			authority,
			coveredRanges: authority.blocks.map(({from,to})=>({from,to})),
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
	const admitted = knownParagraphs ?? discoverParagraphAuthority(state).paragraphs;
	const paragraph = admitted.find(candidate => candidate.from <= position && position <= candidate.to);
	if (!paragraph) return null;
	if (/^[ \t]*$/u.test(state.sliceDoc(paragraph.from, paragraph.to))) return paragraph;
	const tree = pendingMathAt(state, position) ? pendingMathOrdinaryTree(state) : syntaxTree(state);
	if (isHypermdState(state) && !pendingMathAt(state, position)) {
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
