import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';
import type { Tree } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';
import { classifyWhitespaceLine } from './context-analysis.js';
import { listGroupBoundary } from './group-boundary.js';
import { emptyBodies, createdBodyOwnership } from '../runtime/empty-body-state.js';
import type { ListItemSyntax, SourceRange } from './model.js';
import { isSeparatorlessListMarkerLine, markdownColumns, prefixPolicy } from './prefix.js';

interface SyntaxNodeFact extends SourceRange {
	readonly name: string;
}

interface ObsidianSyntaxLine {
	readonly syntax: ListItemSyntax | null;
	readonly indentColumns: number | null;
	readonly isNoBullet: boolean;
	readonly isWhitespace: boolean;
	readonly level: number | null;
	readonly lineNumber: number;
	readonly range: SourceRange;
}

const sourceGrammar = parser.configure(GFM);
const sourceTrees = new WeakMap<Text, Tree>();
export function sourceListTree(state: EditorState): Tree {
	let tree = sourceTrees.get(state.doc);
	if (!tree) {
		tree = sourceGrammar.parse(state.doc.toString());
		sourceTrees.set(state.doc, tree);
	}
	return tree;
}
export interface ListParagraphContinuation {
	readonly lineNumber: number;
	readonly ownerLineNumber: number;
}
const lazyContinuations = new WeakMap<Text, { tree: Tree | null; facts: readonly ListParagraphContinuation[] }>();

export function listParagraphContinuations(state: EditorState): readonly ListParagraphContinuation[] {
	const cached = lazyContinuations.get(state.doc);
	const hostTree = syntaxTree(state);
	if (cached && (cached.tree === null || cached.tree === hostTree)) return cached.facts;
	const facts: ListParagraphContinuation[] = [];
	const tree = collectSyntaxFacts(hostTree).some(fact => fact.name === 'ListItem')
		? hostTree : sourceListTree(state);
	tree.iterate({ enter(node) {
		if (node.name !== 'Paragraph' || node.node.parent?.name !== 'ListItem') return;
		const first = state.doc.lineAt(node.from).number;
		const last = state.doc.lineAt(node.to).number;
		const ownerLineNumber = state.doc.lineAt(node.node.parent.from).number;
		for (let lineNumber = first + 1; lineNumber <= last; lineNumber++) facts.push({ lineNumber, ownerLineNumber });
	} });
	lazyContinuations.set(state.doc, { tree: tree === hostTree ? hostTree : null, facts });
	return facts;
}

function missingBodyLines(state: EditorState, lines: readonly ObsidianSyntaxLine[]): ReadonlySet<number> {
	const known = new Map(lines.map(line => [line.lineNumber, line]));
	const missing = new Set<number>();
	let active = lines[0]!.syntax !== null;
	for (let number = lines[0]!.lineNumber + 1; number <= state.doc.lines; number++) {
		const knownLine = known.get(number);
		if (knownLine) {
			active = knownLine.syntax !== null || knownLine.isNoBullet;
			continue;
		}
		const line = state.doc.line(number);
		if (!line.text.trim()) { active = false; continue; }
		if (active && syntaxTreeAvailable(state, line.to)) missing.add(number);
	}
	return missing;
}

function shallowerBody(line: ObsidianSyntaxLine, ownerLevel: number | null): boolean {
	return line.isNoBullet && !line.isWhitespace && line.level !== null && ownerLevel !== null && line.level < ownerLevel;
}

function shallowBodyLines(state: EditorState, lines: readonly ObsidianSyntaxLine[]): readonly number[] {
	let ownerLevel: number | null = null;
	const candidates: number[] = [];
	for (const line of lines) {
		if (line.syntax) ownerLevel = line.level;
		if (shallowerBody(line, ownerLevel) && syntaxTreeAvailable(state, line.range.to)) candidates.push(line.lineNumber);
	}
	return candidates;
}

function includeMissingLazyLines(state: EditorState, lines: readonly ObsidianSyntaxLine[]): readonly ObsidianSyntaxLine[] {
	if (lines.length === 0) return lines;
	const missing = new Set([...missingBodyLines(state, lines), ...shallowBodyLines(state, lines)]);
	if (missing.size === 0) return lines;
	const normalized = new Map(lines.map(line => [line.lineNumber, line]));
	for (const fact of listParagraphContinuations(state)) {
		if (!missing.has(fact.lineNumber)) continue;
		const owner = lines.find(line => line.lineNumber === fact.ownerLineNumber && line.syntax !== null);
		if (!owner) continue;
		const line = state.doc.line(fact.lineNumber);
		normalized.set(fact.lineNumber, { syntax: null, indentColumns: markdownColumns(/^[ \t]*/u.exec(line.text)![0]),
			isNoBullet: true, isWhitespace: false, level: owner.level, lineNumber: fact.lineNumber, range: range(line.from, line.to) });
	}
	return [...normalized.values()].sort((left, right) => left.lineNumber - right.lineNumber);
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

function fencedListLevels(state: EditorState, facts: readonly SyntaxNodeFact[]): ReadonlyMap<number, number> {
	const levels = new Map(facts.map(fact => [fact.from, obsidianListLevel(fact.name)] as const)
		.filter((entry): entry is readonly [number, number] => entry[1] !== null));
	let level: number | null = null, previousLine = -1;
	for (const fact of facts) {
		const tokens = nodeNameTokens(fact.name);
		const number = state.doc.lineAt(fact.from).number;
		if (tokens.includes('HyperMD-codeblock-begin')) level = obsidianListLevel(fact.name);
		else if (tokens.includes('HyperMD-codeblock') && number === previousLine + 1 && level !== null) levels.set(fact.from, levels.get(fact.from) ?? level);
		else level = null;
		previousLine = number;
		if (tokens.includes('HyperMD-codeblock-end')) level = null;
	}
	return levels;
}

function obsidianListLines(
	state: EditorState,
	facts: readonly SyntaxNodeFact[],
): readonly ObsidianSyntaxLine[] {
	const lines = new Map<number, ObsidianSyntaxLine>();
	const codeLevels = fencedListLevels(state, facts);
	for (const fact of facts) {
		if (!isObsidianListLineName(fact.name)) continue;
		const syntax = syntaxForItem(state, fact, true);
		const physicalLine = state.doc.lineAt(fact.from);
		const lineNumber = physicalLine.number;
		const candidate: ObsidianSyntaxLine = {
			indentColumns: markdownColumns(/^[ \t]*/u.exec(physicalLine.text)![0]),
			isNoBullet: isObsidianNoBulletLineName(fact.name),
			isWhitespace: classifyWhitespaceLine(physicalLine.text) !== null,
			level: codeLevels.get(fact.from) ?? null,
			lineNumber,
			range: range(physicalLine.from, physicalLine.to),
			syntax,
		};
		const existing = lines.get(lineNumber);
		if (!existing || (!existing.syntax && syntax)) lines.set(lineNumber, candidate);
	}
	return includeMissingLazyLines(state, [...lines.values()].sort((left, right) => left.lineNumber - right.lineNumber));
}

function continuesObsidianItem(
	owner: ObsidianSyntaxLine,
	next: ObsidianSyntaxLine,
): boolean {
	if (next.syntax || next.isWhitespace) {
		const prefix = owner.syntax!.prefix;
		const contentColumn = markdownColumns(prefix.indentText + prefix.markerText + prefix.separatorText);
		return next.indentColumns !== null && next.indentColumns >= contentColumn;
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

function independentSeparatorlessLine(owner: ListItemSyntax, text: string): boolean {
	if (!isSeparatorlessListMarkerLine(text)) return false;
	const prefix = owner.prefix;
	const contentColumn = markdownColumns(prefix.indentText + prefix.markerText + prefix.separatorText);
	return markdownColumns(text.match(/^[ \t]*/u)![0]) < contentColumn;
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
			const next = lines[nextIndex]!;
			if (independentSeparatorlessLine(line.syntax, state.doc.line(next.lineNumber).text)) break;
			if (!hasOnlyWhitespaceLinesBetween(state, previousLineNumber, next.lineNumber)) break;
			// HyperMD can report a shallower level for whitespace-only rows. Their
			// Markdown indentation, not that visual level, determines continuation ownership.
			if (next.isWhitespace) {
				if (continuesObsidianItem(line, next)) subtreeTo = next.range.to;
				previousLineNumber = next.lineNumber;
				continue;
			}
			if (!continuesObsidianItem(line, next)) break;
			subtreeTo = next.range.to;
			previousLineNumber = next.lineNumber;
		}
		return [{
			...line.syntax,
			itemNode: range(line.syntax.itemNode.from, subtreeTo),
		}];
	});
}

function persistedBodyWidth(text: string): number | null {
	const match = /^([ \t]*)\u200b[ \t]*$/u.exec(text);
	return match ? markdownColumns(match[1]!) : null;
}

function whitespaceBodyEligible(parentBody: boolean, created: readonly number[], to: number): boolean {
	return parentBody || created.includes(to);
}

function persistedOwnedEnd(persisted: number, contentColumn: number, lineTo: number): number | null {
	return persisted >= contentColumn ? lineTo : null;
}

function trailingOwnedWhitespaceEnd(state: EditorState, item: ListItemSyntax, parentBody: boolean): number {
	let to = item.itemNode.to;
	const created = emptyBodies(state);
	const contentColumn = markdownColumns(state.sliceDoc(state.doc.lineAt(item.markerLine.from).from, item.prefix.outerMarker.to));
	let bare = 0;
	for (let number = state.doc.lineAt(to).number + 1; number <= state.doc.lines; number++) {
		const line = state.doc.line(number);
        const persisted = persistedBodyWidth(line.text);
        if (persisted !== null) {
            const end = persistedOwnedEnd(persisted, contentColumn, line.to);
            if (end === null) break;
            to = end;
            continue;
        }
        if (line.text.trim() !== '') break;
		bare += Number(line.text.length === 0);
		if (bare >= 2) break;
		if (markdownColumns(line.text) >= contentColumn) {
			if (whitespaceBodyEligible(parentBody, created, line.to)) to = line.to;
			bare = 0;
		}
	}
	return to;
}

function runtimeOwnedEnd(state: EditorState, item: ListItemSyntax, originalTo: number): number {
	let to = originalTo;
	for (const body of createdBodyOwnership(state)) {
		if (body.ownerFrom === null) continue;
		if (body.ownerFrom === item.markerLine.from) to = Math.max(to, state.doc.lineAt(body.lineFrom).to);
		else if (item.markerLine.from > body.ownerFrom && item.markerLine.from < body.lineFrom && to >= body.lineFrom) to = state.doc.lineAt(body.lineFrom - 1).to;
	}
	return to;
}

function allListItems(state: EditorState): readonly ListItemSyntax[] {
	const facts = collectSyntaxFacts(syntaxTree(state));
	const standard = standardItems(state, facts);
	const items = standard.length > 0
		? standard
		: normalizedObsidianItems(state, obsidianListLines(state, facts));
	const latestStartByEnd = new Map<number, number>();
	const boundaries: { markerFrom: number; to: number }[] = [];
	for (const item of items) {
		latestStartByEnd.set(item.itemNode.to, Math.max(latestStartByEnd.get(item.itemNode.to) ?? -1, item.itemNode.from));
		const boundary = listGroupBoundary(state.doc, 0, item.markerLine.from);
		if (boundary !== null) boundaries.push({ markerFrom: item.markerLine.from, to: boundary });
	}
	return items.map(item => {
		// Preserve the parent body left after its final nested marker is removed.
		const endsWithDescendant = latestStartByEnd.get(item.itemNode.to)! > item.itemNode.from;
		let to = trailingOwnedWhitespaceEnd(state, item, endsWithDescendant);
		to = runtimeOwnedEnd(state, item, to);
		let first = 0, last = boundaries.length;
		while (first < last) {
			const middle = (first + last) >>> 1;
			if (boundaries[middle]!.markerFrom <= item.markerLine.from) first = middle + 1;
			else last = middle;
		}
		// Marker rows are nonempty, so the first later blank-run boundary is also
		// the earliest boundary the original owner-relative scan can encounter.
		const boundary = boundaries[first];
		if (boundary && boundary.markerFrom <= to) to = Math.min(to, boundary.to);
		return to === item.itemNode.to ? item : {...item, itemNode: range(item.itemNode.from, to)};
	});
}

function intersects(item: SourceRange, ranges: readonly SourceRange[]): boolean {
	return ranges.some((within) => item.from < within.to && within.from < item.to);
}

export function discoverListItem(state: EditorState, position: number): ListItemSyntax | null {
	if (!Number.isInteger(position) || position < 0 || position > state.doc.length) {
		throw new RangeError('List discovery position is outside the document');
	}
	if (isSeparatorlessListMarkerLine(state.doc.lineAt(position).text)) return null;
	return allListItems(state)
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
