import { createdBodyOwnership, emptyBodies } from '../runtime/empty-body-state.js';
import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { discoverCodeBlocks } from '../code-blocks/model.js';
import { discoverMath } from '../math/syntax.js';
import { blockExitAnchors } from '../block-exit.js';
import type {
	ListBlockRef,
	ListItemSyntax,
	SourceRange,
	SourceSnapshot,
	WhitespaceLineFact,
} from './model.js';
import { markdownColumns, prefixPolicy } from './prefix.js';
import { sourceListBlankRuns, type ListBlankRun } from './blank-runs.js';

export interface SourceLine {
	readonly from: number;
	readonly to: number;
	readonly newlineTo: number;
	readonly text: string;
	readonly indentText: string;
	readonly codeLeaf: boolean;
	readonly mathLeaf: boolean;
	readonly blockExitAnchor: boolean;
	readonly createdEmptyBody: boolean;
	readonly whitespaceKind: WhitespaceLineFact['kind'] | null;
}

export interface AnalyzedItem {
	readonly syntax: ListItemSyntax;
	readonly block: ListBlockRef;
	readonly line: SourceLine;
	readonly parentIndex: number | null;
	readonly depth: number;
}

export interface SourceAnalysis {
	readonly source: SourceSnapshot;
	readonly lines: readonly SourceLine[];
	readonly items: readonly AnalyzedItem[];
	readonly blankRuns: ReturnType<typeof sourceListBlankRuns>;
	readonly blankRunsByOwner: ReadonlyMap<number, readonly ListBlankRun[]>;
	readonly blankRowEditable: ReadonlyMap<number, boolean>;
	readonly precedesListItem: ReadonlySet<number>;
	readonly closesNestedList: ReadonlySet<number>;
}

function closesNestedList(analysis: SourceAnalysis, line: SourceLine): boolean {
	return analysis.closesNestedList.has(line.from);
}

export function isEditableOwnedWhitespace(analysis: SourceAnalysis, owner: AnalyzedItem, line: SourceLine): boolean {
	if (line.whitespaceKind === null) return false;
	if (line.whitespaceKind === 'sentinel-tab' || line.text.includes('\u200b')) return true;
	if (line.createdEmptyBody) return true;
	const editable = analysis.blankRowEditable.get(line.from);
	if (editable !== undefined) return editable;
	if (precedesListItem(analysis, line)) return false;
	return editableWhitespaceBody(analysis, owner, line);
}

function precedesListItem(analysis: SourceAnalysis, line: SourceLine): boolean {
	return analysis.precedesListItem.has(line.from);
}

function editableWhitespaceBody(analysis: SourceAnalysis, owner: AnalyzedItem, line: SourceLine): boolean {
	if (line.blockExitAnchor) return true;
	// A single source separator closing a nested list is not an empty parent paragraph.
	if (closesNestedList(analysis, line)) return false;
	return line.indentText.length > 0 && (line.to === owner.block.item.to || line.text.length > line.indentText.length);
}

export const sourceRange = (from: number, to: number): SourceRange => ({ from, to });

/** The maintained delimiter belongs to formatting, but adds no indentation column. */
export function ownedBodyStart(line: SourceLine): number {
	const offset = line.indentText.length;
	return line.from + offset + (line.text[offset] === '\u200b' ? 1 : 0);
}

function snapshotFor(state: EditorState): SourceSnapshot {
	const text = state.doc.toString();
	return Object.freeze({
		length: text.length,
		slice: (range: SourceRange) => text.slice(range.from, range.to),
		text,
	});
}

export function classifyWhitespaceLine(text: string): WhitespaceLineFact['kind'] | null {
	if (text.length === 0) return 'empty';
	if (/^ +$/u.test(text)) return 'ascii-spaces';
	if (/^\t+$/u.test(text)) return 'tabs';
	if (/^\u200b\t+$/u.test(text)) return 'sentinel-tab';
	return /^[ \t\u200b]+$/u.test(text) ? 'mixed-whitespace' : null;
}

function analyzeLines(state: EditorState, source: SourceSnapshot): readonly SourceLine[] {
	const lines: SourceLine[] = [];
	const exits = blockExitAnchors(state);
	const code: SourceRange[] = [...discoverCodeBlocks(state)];
	const math = discoverMath(state).filter(expression => expression.display);
	syntaxTree(state).iterate({ enter(node) {
		if (node.name === 'FencedCode') {
			code.push({ from: state.doc.lineAt(node.from).from, to: node.to });
			return false;
		}
		return undefined;
	} });
	code.sort((left, right) => left.from - right.from);
	math.sort((left, right) => left.from - right.from);
	const bodies = new Map<number, string>();
	createdBodyOwnership(state).forEach(body => {
		if (!bodies.has(body.lineFrom)) bodies.set(body.lineFrom, body.prefix);
	});
	const empty = new Set(emptyBodies(state));
	let codeIndex = 0, codeTo = -1, mathIndex = 0, mathTo = -1;
	const codeLeafAt = (from: number): boolean => {
		while (codeIndex < code.length && code[codeIndex]!.from <= from) codeTo = Math.max(codeTo, code[codeIndex++]!.to);
		return from < codeTo;
	};
	const mathLeafAt = (from: number, to: number): boolean => {
		while (mathIndex < math.length && math[mathIndex]!.from < to) mathTo = Math.max(mathTo, math[mathIndex++]!.to);
		return from < mathTo;
	};
	for (let number = 1; number <= state.doc.lines; number += 1) {
		const documentLine = state.doc.line(number);
		const text = source.text.slice(documentLine.from, documentLine.to);
		const indentText = bodies.get(documentLine.from) ?? /^[ \t]*/u.exec(text)?.[0] ?? '';
		const nextFrom = number < state.doc.lines ? state.doc.line(number + 1).from : documentLine.to;
		lines.push({
			blockExitAnchor: exits.has(documentLine.to),
			createdEmptyBody: bodies.has(documentLine.from) || empty.has(documentLine.to),
			codeLeaf: codeLeafAt(documentLine.from),
			mathLeaf: mathLeafAt(documentLine.from, documentLine.to),
			from: documentLine.from,
			indentText,
			newlineTo: nextFrom,
			text,
			to: documentLine.to,
			whitespaceKind: classifyWhitespaceLine(text),
		});
	}
	return lines;
}

function containerIndent(line: SourceLine, owner: AnalyzedItem): string {
	// Task checkboxes belong to marker content; only the outer list marker sets container width.
	const width = markdownColumns(owner.line.text.slice(0, owner.block.prefix.outerMarker.to - owner.line.from));
	let column = 0;
	let length = 0;
	while (column < width && length < line.indentText.length) {
		column += line.indentText[length] === '\t' ? 4 - column % 4 : 1;
		length += 1;
	}
	return line.indentText.slice(0, length);
}

export function containingLine(lines: readonly SourceLine[], position: number): SourceLine {
	let first = 0, last = lines.length;
	while (first < last) {
		const middle = (first + last) >>> 1;
		if (lines[middle]!.to < position) first = middle + 1;
		else last = middle;
	}
	const found = lines[first];
	if (!found || !(found.from <= position && position <= found.to)) throw new RangeError('Position is not in an analyzed source line');
	return found;
}

function containmentIndexes(items: readonly ListItemSyntax[], lines: readonly SourceLine[]) {
	const ranges = items.map((item, index) => ({ from: item.itemNode.from, to: item.itemNode.to, index }));
	const ordered = [...ranges].sort((left, right) => left.from - right.from);
	const ends = [...new Set(ranges.map(item => item.to))].sort((left, right) => left - right);
	const parents = ranges.map<number | null>(() => null);
	const owners = lines.map<number | null>(() => null);
	const depths = ranges.map(() => 0);
	const queries = [
		...ranges.map(item => ({ ...item, parent: true, result: parents })),
		...lines.map((line, index) => ({ from: line.to, to: line.to, index, parent: false, result: owners })),
	].sort((left, right) => left.from - right.from || Number(right.parent) - Number(left.parent));
	const endIndex = (to: number): number => {
		let first = 0, last = ends.length;
		while (first < last) {
			const middle = (first + last) >>> 1;
			if (ends[middle]! < to) first = middle + 1;
			else last = middle;
		}
		return ends.length - first;
	};
	const better = (left: number | null, right: number | null): number | null => {
		if (left === null) return right;
		if (right === null) return left;
		const a = ranges[left]!, b = ranges[right]!;
		const difference = (a.to - a.from) - (b.to - b.from);
		return difference < 0 || difference === 0 && left < right ? left : right;
	};
	// Reverse end ranks form a suffix-min Fenwick index. It preserves crossing
	// ranges and stable size ties without assuming syntax owners stay nested.
	const best = Array.from({ length: ends.length + 1 }, (): number | null => null);
	const admit = (index: number, to: number): void => {
		for (let at = endIndex(to); at < best.length; at += at & -at) best[at] = better(best[at]!, index);
	};
	const containing = (to: number): number | null => {
		let found: number | null = null;
		for (let at = endIndex(to); at > 0; at -= at & -at) found = better(found, best[at]!);
		return found;
	};
	let cursor = 0;
	for (const query of queries) {
		while (cursor < ordered.length && (ordered[cursor]!.from < query.from ||
			!query.parent && ordered[cursor]!.from === query.from)) {
			const item = ordered[cursor++]!;
			admit(item.index, item.to);
		}
		query.result[query.index] = containing(query.to);
	}
	for (const item of ordered) {
		const parent = parents[item.index]!;
		depths[item.index] = parent === null ? 0 : depths[parent]! + 1;
	}
	return { parents, owners, depths };
}

function blockFor(syntax: ListItemSyntax, line: SourceLine, source: SourceSnapshot): ListBlockRef {
	return {
		content: sourceRange(syntax.prefix.full.to, line.to),
		contentIndentText: prefixPolicy.contentIndent(source.text.slice(line.from, syntax.prefix.taskToken?.to ?? syntax.prefix.outerMarker.to)),
		item: sourceRange(syntax.itemNode.from, syntax.itemNode.to),
		lineFrom: line.from,
		markerLine: sourceRange(syntax.markerLine.from, syntax.markerLine.to),
		prefix: syntax.prefix,
	};
}

function blankRunIndexes(blankRuns: SourceAnalysis['blankRuns']) {
	const blankRunsByOwner = new Map<number, ListBlankRun[]>();
	const blankRowEditable = new Map<number, boolean>();
	for (const { ownerFrom, run } of blankRuns) {
		let runs = blankRunsByOwner.get(ownerFrom);
		if (!runs) blankRunsByOwner.set(ownerFrom, runs = []);
		runs.push(run);
		for (const row of run.rows) blankRowEditable.set(row.at, row.kind === 'editable');
	}
	return { blankRunsByOwner, blankRowEditable };
}

function itemsByMarkerStart(items: readonly AnalyzedItem[]) {
	const markerItems = new Map<number | undefined, AnalyzedItem>();
	for (const item of items) if (!markerItems.has(item.line.from)) markerItems.set(item.line.from, item);
	return markerItems;
}

function nestedListCloses(previous: AnalyzedItem | undefined, next: AnalyzedItem | undefined): boolean {
	return previous !== undefined && next !== undefined && previous.depth > next.depth;
}

function whitespaceIndexes(lines: readonly SourceLine[], items: readonly AnalyzedItem[]) {
	const markerItems = itemsByMarkerStart(items);
	const precedesListItem = new Set<number>(), closesNestedList = new Set<number>();
	let nextIsItem = false;
	for (let index = lines.length - 1; index >= 0; index--) {
		const line = lines[index]!;
		if (nextIsItem) precedesListItem.add(line.from);
		if (line.whitespaceKind === null) nextIsItem = markerItems.has(line.from);
		if (nestedListCloses(markerItems.get(lines[index - 1]?.from), markerItems.get(lines[index + 1]?.from))) closesNestedList.add(line.from);
	}
	return { precedesListItem, closesNestedList };
}

export function analyzeSource(
	state: EditorState,
	syntaxItems: readonly ListItemSyntax[],
): SourceAnalysis {
	const source = snapshotFor(state);
	const lines = analyzeLines(state, source);
	const { parents, owners, depths } = containmentIndexes(syntaxItems, lines);
	const items = syntaxItems.map((syntax, index): AnalyzedItem => {
		const line = containingLine(lines, syntax.markerLine.from);
		return {
			block: blockFor(syntax, line, source),
			depth: depths[index]!,
			line,
			parentIndex: parents[index]!,
			syntax,
		};
	});
	const normalizedLines = lines.map((line, index) => {
		const ownerIndex = owners[index]!;
		const owner = ownerIndex === null ? null : items[ownerIndex]!;
		return owner && owner.line.from !== line.from
			? { ...line, indentText: containerIndent(line, owner) }
			: line;
	});
	const normalized = { items, lines: normalizedLines, source };
	const blankRuns = sourceListBlankRuns(normalized);
	return {...normalized, blankRuns, ...blankRunIndexes(blankRuns), ...whitespaceIndexes(normalizedLines, items)};
}

export function itemAtPosition(
	analysis: Pick<SourceAnalysis, 'items'>,
	position: number,
): AnalyzedItem | null {
	const candidates = analysis.items
		.filter((item) => item.block.item.from <= position && position <= item.block.item.to)
		.sort((left, right) =>
			(left.block.item.to - left.block.item.from) - (right.block.item.to - right.block.item.from));
	return candidates[0] ?? null;
}

export function isOnlyBoundaryWhitespace(text: string): boolean {
	return /^[\n \t\u200b]*$/u.test(text);
}

export function isOnlyIndentation(text: string): boolean {
	return /^[ \t\u200b]*$/u.test(text);
}
