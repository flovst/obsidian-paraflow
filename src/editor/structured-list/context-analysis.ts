import { createdBodyOwnership } from '../runtime/empty-body-state.js';
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
import { isCreatedListEmptyBody } from './empty-body-state.js';
import { sourceListBlankRuns } from './blank-runs.js';

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
}

function closesNestedList(analysis: SourceAnalysis, line: SourceLine): boolean {
	const index = analysis.lines.indexOf(line);
	const previous = analysis.items.find(item => item.line.from === analysis.lines[index - 1]?.from);
	const next = analysis.items.find(item => item.line.from === analysis.lines[index + 1]?.from);
	return previous !== undefined && next !== undefined && previous.depth > next.depth;
}

export function isEditableOwnedWhitespace(analysis: SourceAnalysis, owner: AnalyzedItem, line: SourceLine): boolean {
	if (line.whitespaceKind === null) return false;
	if (line.whitespaceKind === 'sentinel-tab' || line.text.includes('\u200b')) return true;
	if (line.createdEmptyBody) return true;
	const run = analysis.blankRuns.find(candidate =>
		candidate.run.range.from < line.from && line.from < candidate.run.range.to)?.run;
	if (run) return run.editableBodies.some(body => body.to === line.to);
	if (precedesListItem(analysis, line)) return false;
	return editableWhitespaceBody(analysis, owner, line);
}

function precedesListItem(analysis: SourceAnalysis, line: SourceLine): boolean {
	const next = analysis.lines.find(candidate => candidate.from > line.to && candidate.whitespaceKind === null);
	return next !== undefined && analysis.items.some(item => item.line.from === next.from);
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
	for (let number = 1; number <= state.doc.lines; number += 1) {
		const documentLine = state.doc.line(number);
		const text = source.text.slice(documentLine.from, documentLine.to);
		const knownBody = createdBodyOwnership(state).find(body => body.lineFrom === documentLine.from);
        const indentText = knownBody?.prefix ?? /^[ \t]*/u.exec(text)?.[0] ?? '';
		const nextFrom = number < state.doc.lines ? state.doc.line(number + 1).from : documentLine.to;
		lines.push({
			blockExitAnchor: exits.has(documentLine.to),
		createdEmptyBody: createdBodyLine(state, documentLine.from, documentLine.to),
			codeLeaf: code.some(block => block.from <= documentLine.from && documentLine.from < block.to),
			mathLeaf: math.some(block => block.from < documentLine.to && documentLine.from < block.to),
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

function createdBodyLine(state: EditorState, from: number, to: number): boolean {
	return createdBodyOwnership(state).some(body => body.lineFrom === from) || isCreatedListEmptyBody(state, to);
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
	return {
		content: sourceRange(syntax.prefix.full.to, line.to),
		contentIndentText: prefixPolicy.contentIndent(source.text.slice(line.from, syntax.prefix.taskToken?.to ?? syntax.prefix.outerMarker.to)),
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
	const analysis = { items, lines, source };
	const normalizedLines = lines.map(line => {
		const owner = itemAtPosition(analysis, line.to);
		return owner && owner.line.from !== line.from
			? { ...line, indentText: containerIndent(line, owner) }
			: line;
	});
	const normalized = {...analysis,lines:normalizedLines};
	return {...normalized,blankRuns:sourceListBlankRuns(normalized)};
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
