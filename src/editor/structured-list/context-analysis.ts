import type { EditorState } from '@codemirror/state';
import type {
	ListBlockRef,
	ListItemSyntax,
	SourceRange,
	SourceSnapshot,
	WhitespaceLineFact,
} from './model.js';
import { prefixPolicy } from './prefix.js';

export interface SourceLine {
	readonly from: number;
	readonly to: number;
	readonly newlineTo: number;
	readonly text: string;
	readonly indentText: string;
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
}

export const sourceRange = (from: number, to: number): SourceRange => ({ from, to });

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
	for (let number = 1; number <= state.doc.lines; number += 1) {
		const documentLine = state.doc.line(number);
		const text = source.text.slice(documentLine.from, documentLine.to);
		const indentText = /^[ \t\u200b]*/u.exec(text)?.[0] ?? '';
		const nextFrom = number < state.doc.lines ? state.doc.line(number + 1).from : documentLine.to;
		lines.push({
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

export function containingLine(lines: readonly SourceLine[], position: number): SourceLine {
	const found = lines.find((line) => line.from <= position && position <= line.to);
	if (!found) throw new RangeError('Position is not in an analyzed source line');
	return found;
}

function containsItem(candidate: ListItemSyntax, current: ListItemSyntax): boolean {
	return candidate.itemNode.from < current.itemNode.from &&
		candidate.itemNode.to >= current.itemNode.to;
}

function isParentCandidate(
	candidate: ListItemSyntax,
	current: ListItemSyntax,
	candidateIndex: number,
	currentIndex: number,
): boolean {
	return candidateIndex !== currentIndex && containsItem(candidate, current);
}

function parentIndexFor(items: readonly ListItemSyntax[], index: number): number | null {
	const current = items[index];
	if (!current) return null;
	const parents = items
		.map((candidate, candidateIndex) => ({ candidate, index: candidateIndex }))
		.filter(({ candidate, index: candidateIndex }) =>
			isParentCandidate(candidate, current, candidateIndex, index))
		.sort((left, right) =>
			(left.candidate.itemNode.to - left.candidate.itemNode.from) -
			(right.candidate.itemNode.to - right.candidate.itemNode.from));
	return parents[0]?.index ?? null;
}

function depthFor(parentIndexes: readonly (number | null)[], index: number): number {
	let depth = 0;
	let parent = parentIndexes[index] ?? null;
	const seen = new Set<number>();
	while (parent !== null && !seen.has(parent)) {
		seen.add(parent);
		depth += 1;
		parent = parentIndexes[parent] ?? null;
	}
	return depth;
}

function blockFor(syntax: ListItemSyntax, line: SourceLine, source: SourceSnapshot): ListBlockRef {
	const outerIndent = source.text.slice(line.from, syntax.prefix.full.from);
	return {
		content: sourceRange(syntax.prefix.full.to, line.to),
		contentIndentText: `${outerIndent}${prefixPolicy.contentIndent(syntax.prefix)}`,
		item: sourceRange(syntax.itemNode.from, syntax.itemNode.to),
		lineFrom: line.from,
		markerLine: sourceRange(syntax.markerLine.from, syntax.markerLine.to),
		prefix: syntax.prefix,
	};
}

export function analyzeSource(
	state: EditorState,
	syntaxItems: readonly ListItemSyntax[],
): SourceAnalysis {
	const source = snapshotFor(state);
	const lines = analyzeLines(state, source);
	const parentIndexes = syntaxItems.map((_, index) => parentIndexFor(syntaxItems, index));
	const items = syntaxItems.map((syntax, index): AnalyzedItem => {
		const line = containingLine(lines, syntax.markerLine.from);
		return {
			block: blockFor(syntax, line, source),
			depth: depthFor(parentIndexes, index),
			line,
			parentIndex: parentIndexes[index] ?? null,
			syntax,
		};
	});
	return { items, lines, source };
}

export function itemAtPosition(
	analysis: SourceAnalysis,
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
