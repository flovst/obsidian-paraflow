import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { Tree } from '@lezer/common';
import type { ListItemSyntax, SourceRange } from './model.js';
import { prefixPolicy } from './prefix.js';

interface SyntaxNodeFact extends SourceRange {
	readonly name: string;
}

interface ObsidianListLine {
	readonly syntax: ListItemSyntax;
	readonly indentColumns: number;
	readonly lineNumber: number;
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
	const markerLine = range(itemNode.from, line.to);
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
	return { itemNode, markerLine, prefix };
}

function nodeNameTokens(name: string): readonly string[] {
	return name.split(/[\s_]+/u);
}

export function isObsidianListLineName(name: string): boolean {
	return nodeNameTokens(name).includes('HyperMD-list-line');
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
): readonly ObsidianListLine[] {
	const lines = new Map<number, ObsidianListLine>();
	for (const fact of facts) {
		if (!isObsidianListLineName(fact.name)) continue;
		const syntax = syntaxForItem(state, fact, true);
		if (!syntax) continue;
		lines.set(syntax.markerLine.from, {
			indentColumns: indentColumns(syntax.prefix.indentText),
			lineNumber: state.doc.lineAt(syntax.markerLine.from).number,
			syntax,
		});
	}
	return [...lines.values()].sort((left, right) =>
		left.syntax.markerLine.from - right.syntax.markerLine.from);
}

function normalizedObsidianItems(lines: readonly ObsidianListLine[]): readonly ListItemSyntax[] {
	return lines.map((line, index) => {
		let subtreeTo = line.syntax.markerLine.to;
		let previousLineNumber = line.lineNumber;
		for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
			const next = lines[nextIndex];
			if (!next || next.lineNumber !== previousLineNumber + 1) break;
			if (next.indentColumns <= line.indentColumns) break;
			subtreeTo = next.syntax.markerLine.to;
			previousLineNumber = next.lineNumber;
		}
		return {
			...line.syntax,
			itemNode: range(line.syntax.itemNode.from, subtreeTo),
		};
	});
}

function allListItems(state: EditorState): readonly ListItemSyntax[] {
	const facts = collectSyntaxFacts(syntaxTree(state));
	const standard = standardItems(state, facts);
	return standard.length > 0
		? standard
		: normalizedObsidianItems(obsidianListLines(state, facts));
}

function intersects(item: SourceRange, ranges: readonly SourceRange[]): boolean {
	return ranges.some((within) => item.from < within.to && within.from < item.to);
}

export function discoverListItem(state: EditorState, position: number): ListItemSyntax | null {
	const boundedPosition = Math.max(0, Math.min(position, state.doc.length));
	return allListItems(state)
		.filter((item) => item.itemNode.from <= boundedPosition && boundedPosition <= item.itemNode.to)
		.sort((left, right) =>
			(left.itemNode.to - left.itemNode.from) - (right.itemNode.to - right.itemNode.from))[0] ?? null;
}

export function enumerateListItems(
	state: EditorState,
	within?: readonly SourceRange[],
): readonly ListItemSyntax[] {
	return allListItems(state).filter((item) => !within || intersects(item.itemNode, within));
}
