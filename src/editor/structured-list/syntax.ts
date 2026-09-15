import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { Tree } from '@lezer/common';
import { classifyWhitespaceLine } from './context-analysis.js';
import type { ListItemSyntax, SourceRange } from './model.js';
import { isSeparatorlessListMarkerLine, prefixPolicy } from './prefix.js';

interface SyntaxNodeFact extends SourceRange {
	readonly name: string;
}

interface ObsidianSyntaxLine {
	readonly syntax: ListItemSyntax | null;
	readonly indentColumns: number | null;
	readonly isNoBullet: boolean;
	readonly level: number | null;
	readonly lineNumber: number;
	readonly range: SourceRange;
}

function range(from: number, to: number): SourceRange {
	return { from, to };
}

function syntaxForItem(
	state: EditorState,
	itemNode: SourceRange,
	replacementStartsAfterIndent = false,
): ListItemSyntax | null {
	const line = state.doc.lineAt(itemNode.from);
	const normalizedItemNode = replacementStartsAfterIndent
		? range(line.from, itemNode.to)
		: itemNode;
	const markerLine = range(normalizedItemNode.from, line.to);
	const parsed = prefixPolicy.parse(state.sliceDoc(markerLine.from, markerLine.to), markerLine.from);
	if (!parsed) return null;
	const prefix = replacementStartsAfterIndent && parsed.indentText.length > 0
		? {
			...parsed,
			outerMarker: range(
				parsed.outerMarker.from + parsed.indentText.length,
				parsed.outerMarker.to,
			),
		}
		: parsed;
	return { itemNode: normalizedItemNode, markerLine, prefix };
}

function nodeNameTokens(name: string): readonly string[] {
	return name.split(/[\s_]+/u);
}

export function isObsidianListLineName(name: string): boolean {
	return nodeNameTokens(name).includes('HyperMD-list-line');
}

function obsidianListLevel(name: string): number | null {
	for (const token of nodeNameTokens(name)) {
		const match = /^HyperMD-list-line-(\d+)$/u.exec(token);
		if (!match) continue;
		const level = Number(match[1]);
		if (Number.isSafeInteger(level) && level > 0) return level;
	}
	return null;
}

function isObsidianNoBulletLineName(name: string): boolean {
	return nodeNameTokens(name).includes('HyperMD-list-line-nobullet');
}

function indentColumns(indent: string): number {
	let column = 0;
	for (const character of indent) {
		column = character === '\t' ? column + (4 - column % 4) : column + 1;
	}
	return column;
}

function collectSyntaxFacts(tree: Tree): readonly SyntaxNodeFact[] {
	const facts: SyntaxNodeFact[] = [];
	tree.iterate({
		enter: (node) => {
			if (node.name === 'ListItem' || isObsidianListLineName(node.name)) {
				facts.push({ from: node.from, name: node.name, to: node.to });
			}
		},
	});
	return facts;
}

function standardItems(
	state: EditorState,
	facts: readonly SyntaxNodeFact[],
): readonly ListItemSyntax[] {
	return facts
		.filter((fact) => fact.name === 'ListItem')
		.map((fact) => syntaxForItem(state, range(fact.from, fact.to)))
		.filter((item): item is ListItemSyntax => item !== null);
}

function obsidianListLines(
	state: EditorState,
	facts: readonly SyntaxNodeFact[],
): readonly ObsidianSyntaxLine[] {
	const lines = new Map<number, ObsidianSyntaxLine>();
	for (const fact of facts) {
		if (!isObsidianListLineName(fact.name)) continue;
		const syntax = syntaxForItem(state, fact, true);
		const physicalLine = state.doc.lineAt(fact.from);
		const lineNumber = physicalLine.number;
		const candidate: ObsidianSyntaxLine = {
			indentColumns: syntax ? indentColumns(syntax.prefix.indentText) : null,
			isNoBullet: isObsidianNoBulletLineName(fact.name),
			level: obsidianListLevel(fact.name),
			lineNumber,
			range: range(physicalLine.from, physicalLine.to),
			syntax,
		};
		const existing = lines.get(lineNumber);
		if (!existing || (!existing.syntax && syntax)) lines.set(lineNumber, candidate);
	}
	return [...lines.values()].sort((left, right) =>
		left.lineNumber - right.lineNumber);
}

function continuesObsidianItem(
	owner: ObsidianSyntaxLine,
	next: ObsidianSyntaxLine,
): boolean {
	if (next.syntax) {
		return next.indentColumns !== null && owner.indentColumns !== null &&
			next.indentColumns > owner.indentColumns;
	}
	return next.isNoBullet && owner.level !== null && next.level !== null &&
		next.level >= owner.level;
}

function hasOnlyWhitespaceLinesBetween(
	state: EditorState,
	previousLineNumber: number,
	nextLineNumber: number,
): boolean {
	for (let lineNumber = previousLineNumber + 1; lineNumber < nextLineNumber; lineNumber += 1) {
		if (classifyWhitespaceLine(state.doc.line(lineNumber).text) === null) return false;
	}
	return true;
}

function normalizedObsidianItems(
	state: EditorState,
	lines: readonly ObsidianSyntaxLine[],
): readonly ListItemSyntax[] {
	return lines.flatMap((line, index): readonly ListItemSyntax[] => {
		if (!line.syntax) return [];
		let subtreeTo = line.syntax.markerLine.to;
		let previousLineNumber = line.lineNumber;
		for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
			const next = lines[nextIndex];
			if (!next || !continuesObsidianItem(line, next)) break;
			if (!hasOnlyWhitespaceLinesBetween(state, previousLineNumber, next.lineNumber)) break;
			subtreeTo = next.range.to;
			previousLineNumber = next.lineNumber;
		}
		return [{
			...line.syntax,
			itemNode: range(line.syntax.itemNode.from, subtreeTo),
		}];
	});
}

function allListItems(state: EditorState): readonly ListItemSyntax[] {
	const facts = collectSyntaxFacts(syntaxTree(state));
	const standard = standardItems(state, facts);
	return standard.length > 0
		? standard
		: normalizedObsidianItems(state, obsidianListLines(state, facts));
}

function intersects(item: SourceRange, ranges: readonly SourceRange[]): boolean {
	return ranges.some((within) => item.from < within.to && within.from < item.to);
}

export function discoverListItem(state: EditorState, position: number): ListItemSyntax | null {
	if (!Number.isInteger(position) || position < 0 || position > state.doc.length) {
		throw new RangeError('List discovery position is outside the document');
	}
	if (isSeparatorlessListMarkerLine(state.doc.lineAt(position).text)) return null;
	const facts = collectSyntaxFacts(syntaxTree(state));
	const standardFacts = facts.filter((fact) => fact.name === 'ListItem');
	if (standardFacts.length > 0) {
		const deepest = standardFacts
			.filter((fact) => fact.from <= position && position <= fact.to)
			.sort((left, right) =>
				(left.to - left.from) - (right.to - right.from))[0];
		return deepest ? syntaxForItem(state, range(deepest.from, deepest.to)) : null;
	}
	return normalizedObsidianItems(state, obsidianListLines(state, facts))
		.filter((item) => item.itemNode.from <= position && position <= item.itemNode.to)
		.sort((left, right) =>
			(left.itemNode.to - left.itemNode.from) - (right.itemNode.to - right.itemNode.from))[0] ?? null;
}

export function enumerateListItems(
	state: EditorState,
	within?: readonly SourceRange[],
): readonly ListItemSyntax[] {
	return allListItems(state).filter((item) => !within || intersects(item.itemNode, within));
}
