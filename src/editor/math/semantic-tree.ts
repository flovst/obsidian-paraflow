import { ensureSyntaxTree, language, syntaxTree, type Language } from '@codemirror/language';
import { EditorState, Facet, type Text } from '@codemirror/state';
import { NodeType, Tree, type Parser, type SyntaxNode } from '@lezer/common';
// eslint-disable-next-line import/no-extraneous-dependencies -- Uses the same highlight tags as CodeMirror's native language highlighter.
import { styleTags, tags } from '@lezer/highlight';
import { codeParserSource, maskCodeSource, type CodeParserRange, type CodeParserSource } from '../code-blocks/parser-source.js';
import { quoteDraftMasks, maskQuoteDraftSource } from '../callout/quote-draft.js';
import { pendingMathRanges, type PendingMathRange } from './candidate-ranges.js';
import { acceptedMath, discoverMath, mathRangeIndex } from './syntax.js';
import type { MathExpression } from './range-scanner.js';
import { createRangeQuery } from './range-query.js';

export function isLiteralDollarLine(text: string): boolean { return /^[ \t]*(?:>[ \t]*)*\${3,}$/u.test(text); }
export const baseMathLanguage = Facet.define<Language, Language | null>({ combine: values => values[0] ?? null });
const trees = new WeakMap<Text, { parser: Parser; ranges: readonly PendingMathRange[]; accepted: readonly MathExpression[]; code: CodeParserSource; quotes: readonly PendingMathRange[]; tree: Tree }>();
const dollarPresence = new WeakMap<Text, boolean>();
function containsDollar(doc: Text): boolean {
	const cached = dollarPresence.get(doc);
	if (cached !== undefined) return cached;
	let found = false;
	for (const part of doc.iter()) if (part.includes('$')) { found = true; break; }
	dollarPresence.set(doc, found);
	return found;
}
const codeToken = NodeType.define({ name: 'FencedCode', id: 4 });
const begin = NodeType.define({ name: 'formatting_formatting-math_math', id: 0, props: [styleTags({ 'formatting_formatting-math_math': tags.keyword })] });
const block = NodeType.define({ name: 'formatting_formatting-math_math-block_math', id: 1, props: [styleTags({ 'formatting_formatting-math_math-block_math': tags.keyword })] });
const body = NodeType.define({ name: 'math', id: 2, props: [styleTags({ math: tags.string })] });
const end = NodeType.define({ name: 'formatting_formatting-math-end_math', id: 3, props: [styleTags({ 'formatting_formatting-math-end_math': tags.keyword })] });

export function acceptedParserMath(state: EditorState, ranges: readonly PendingMathRange[]): readonly MathExpression[] {
	const pending = createRangeQuery(ranges);
	return discoverMath(state).filter(math => !math.display || !pending.contains(math.from, math.to));
}
/** Neutralize Markdown dollars and accepted bodies, preserving opaque code/HTML input. */
export function mathParserMasks(state: EditorState, ranges: readonly PendingMathRange[], accepted = acceptedParserMath(state, ranges)): readonly PendingMathRange[] {
	const masks: PendingMathRange[] = [...accepted];
	const opaque = createRangeQuery(mathRangeIndex(state).opaque);
	for (const match of state.sliceDoc().matchAll(/\$+/gu)) {
		if (!opaque.containsPoint(match.index)) masks.push({ from: match.index, to: match.index + match[0].length });
	}
	masks.sort((a, b) => a.from - b.from || b.to - a.to);
	const merged: PendingMathRange[] = [];
	for (const mask of masks) {
		const previous = merged.at(-1);
		if (previous && mask.from <= previous.to) merged[merged.length - 1] = { from: previous.from, to: Math.max(previous.to, mask.to) };
		else merged.push(mask);
	}
	return merged;
}
export function maskMathSource(source: string, masks: readonly PendingMathRange[], fill: 'x' | ' ' = 'x'): string {
	let result = '', from = 0;
	for (const mask of masks) {
		result += source.slice(from, mask.from) + source.slice(mask.from, mask.to).split('\n').map((line, index) => {
			const prefix = index ? /^[ \t]*(?:>[ \t]*)*/u.exec(line)![0] : '';
			return prefix + line.slice(prefix.length).replace(/[^\r]/g, fill);
		}).join('\n');
		from = mask.to;
	}
	return result + source.slice(from);
}
export function maskedMathSource(state: EditorState, masks: readonly PendingMathRange[]): string { return maskMathSource(state.sliceDoc(), masks); }

/** Insert owned semantic tokens while retaining native container and language metadata. */
export function projectMathTree(tree: Tree, expressions: readonly MathExpression[], code: readonly CodeParserRange[] = []): Tree {
	if (!expressions.length && !code.length) return tree;
	const tokens = expressions.flatMap(math => [
		{ from: math.from, to: math.contentFrom, type: math.display ? block : begin },
		{ from: math.contentFrom, to: math.contentTo, type: body },
		{ from: math.contentTo, to: math.to, type: end },
	]).concat(code.map(range => ({ ...range, type: codeToken }))).sort((a, b) => a.from - b.from);
	function project(node: SyntaxNode, admitted: typeof tokens): Tree {
		const children: { from: number; tree: Tree }[] = [];
		let nextToken = 0;
		let active: typeof tokens = [];
		const overlapping = (from: number, to: number): typeof tokens => {
			active = active.filter(token => token.to > from);
			while (nextToken < admitted.length && admitted[nextToken]!.from < to) {
				const token = admitted[nextToken++]!;
				if (token.to > from) active.push(token);
			}
			return active;
		};
		const insert = (from: number, to: number): void => {
			if (from >= to) return;
			for (const token of overlapping(from, to)) {
				const start = Math.max(from, token.from), stop = Math.min(to, token.to);
				if (start < stop) children.push({ from: start, tree: new Tree(token.type, [], [], stop - start) });
			}
		};
		let position = node.from;
		for (let child = node.firstChild; child; child = child.nextSibling) {
			insert(position, child.from);
			const overlaps = overlapping(child.from, child.to);
			const structuralPrefix = /^(?:QuoteMark|ListMark)$/u.test(child.name) || child.name.split('_').some(name => /^(?:formatting-quote|formatting-list)(?:-|$)/u.test(name));
			if (!overlaps.length || structuralPrefix) children.push({ from: child.from, tree: child.toTree() });
			else if (child.firstChild || /^(?:Paragraph|TableCell|ATXHeading[1-6]|SetextHeading[12]|HyperMD-)/u.test(child.name)) {
				children.push({ from: child.from, tree: project(child, overlaps) });
			} else {
				let from = child.from;
				for (const token of overlaps) {
					if (from < token.from) children.push({ from, tree: new Tree(child.type, [], [], token.from - from) });
					from = Math.max(from, token.to);
				}
				if (from < child.to) children.push({ from, tree: new Tree(child.type, [], [], child.to - from) });
				insert(child.from, child.to);
			}
			position = child.to;
		}
		insert(position, node.to);
		children.sort((a, b) => a.from - b.from);
		return new Tree(node.type, children.map(child => child.tree), children.map(child => child.from - node.from), node.to - node.from, node.toTree().propValues);
	}
	return project(tree.topNode, tokens);
}

/** Consumers share the same ownership even before the editor's parser compartment mounts. */
export function mathSyntaxTree(state: EditorState): Tree {
	if (state.facet(baseMathLanguage)) return syntaxTree(state);
	const code = state.facet(codeParserSource), quotes = state.facet(quoteDraftMasks);
	if (!containsDollar(state.doc) && !code.masks.length && !quotes.length) return syntaxTree(state);
	const native = state.facet(language);
	if (!native) return syntaxTree(state);
	const ranges = pendingMathRanges(state), accepted = state.facet(acceptedMath), cached = trees.get(state.doc);
	if (cached?.parser === native.parser && cached.ranges === ranges && cached.accepted === accepted && cached.code === code && cached.quotes === quotes) return cached.tree;
	const expressions = acceptedParserMath(state, ranges), masks = mathParserMasks(state, ranges, expressions);
	if (!masks.length && !code.masks.length && !quotes.length) return syntaxTree(state);
	const shadow = EditorState.create({ doc: maskQuoteDraftSource(maskCodeSource(maskedMathSource(state, masks), code.masks), quotes), extensions: [native] });
	const parsed = ensureSyntaxTree(shadow, shadow.doc.length, Infinity);
	if (!parsed) throw new Error('Math semantic source did not complete parsing');
	const tree = projectMathTree(parsed, expressions, code.opaque);
	trees.set(state.doc, { parser: native.parser, ranges, accepted, code, quotes, tree });
	return tree;
}
