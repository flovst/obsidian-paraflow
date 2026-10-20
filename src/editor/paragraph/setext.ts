import type { EditorState, Text } from '@codemirror/state';
import { GFM, parser } from '@lezer/markdown';
import { metadataGrammar, nativeInlineGrammarFor } from '../markdown-grammar.js';
import { mathRangeIndex } from '../math/syntax.js';
import type { SetextHeadingBlock } from './model.js';

const grammar = parser.configure([GFM, metadataGrammar, {
	defineNodes: [{ name: 'SetextCalloutHeader', block: true }],
	parseBlock: [{ name: 'SetextCalloutHeader', before: 'FencedCode', parse(context, line) {
		if (context.parentType().name !== 'Blockquote' || !/^\[![^\]\r\n]+\][+-]?(?:\s|$)/u.test(line.text.slice(line.pos))) return false;
		context.addElement(context.elt('SetextCalloutHeader', context.lineStart + line.pos, context.lineStart + line.text.length));
		context.nextLine();
		return true;
	} }],
}]);
const cache = new WeakMap<Text, readonly SetextHeadingBlock[]>();

/** Standard Setext ownership is independent of HyperMD's per-line heading tokens. */
export function discoverSetextHeadings(state: EditorState): readonly SetextHeadingBlock[] {
	const cached = cache.get(state.doc);
	if (cached) return cached;
	const headings: SetextHeadingBlock[] = [];
	grammar.configure(nativeInlineGrammarFor(mathRangeIndex(state).expressions)).parse(state.doc.toString()).iterate({ enter(node) {
		if (!/^SetextHeading[12]$/u.test(node.name)) return;
		const first = state.doc.lineAt(node.from), underline = state.doc.lineAt(node.to);
		const lines = [];
		for (let number = first.number; number < underline.number; number++) {
			const line = state.doc.line(number);
			const contentFrom = number === first.number ? node.from : line.from + /^[ \t]*(?:>[ \t]*)*/u.exec(line.text)![0].length;
			lines.push({ from: line.from, contentFrom, to: line.to });
		}
		headings.push({ from: first.from, to: node.to, contentFrom: node.from, contentTo: lines.at(-1)!.to,
			underlineFrom: underline.from, underlineTo: node.to, level: Number(node.name.at(-1)) as 1 | 2,
			topLevel: node.node.parent?.name === 'Document', lines });
	} });
	cache.set(state.doc, headings);
	return headings;
}
