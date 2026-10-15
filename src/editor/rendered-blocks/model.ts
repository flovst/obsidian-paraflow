import { Text, type EditorState } from '@codemirror/state';
import { parser } from '@lezer/markdown';
import { findTableSources } from '../table/edit-session.js';
import { metadataGrammar, nativeInlineGrammarFor } from '../callout/syntax.js';
import { mathRangeIndex } from '../math/syntax.js';
export interface RenderedBlock {
	kind: 'html' | 'mermaid'; from: number; to: number; bodyFrom: number; bodyTo: number;
	lines: { from: number; to: number; contentFrom: number; number: number }[];
	/** Container prefixes are excluded from the independent Markdown render. */
	source: string;
	fence: { openingTo: number; closingFrom: number; continuation: string } | null;
}
const cache = new WeakMap<Text, RenderedBlock[]>();
const grammar = parser.configure(metadataGrammar);
const tagPattern = /<!--[\s\S]*?(?:-->|$)|<\/?[A-Za-z][\w:-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/gu;

export function discoverRenderedBlocks(state: EditorState): RenderedBlock[] {
	const cached = cache.get(state.doc);
	if (cached) return cached;
	const source = state.doc.toString();
	const blocks: RenderedBlock[] = [];
	const tables = findTableSources(source);
	grammar.configure(nativeInlineGrammarFor(mathRangeIndex(state).expressions)).parse(source).iterate({ enter(node) {
		if (blocks.some(block => node.from >= block.from && node.from < block.to)) return false;
		if (tables.some(table => node.from >= table.from && node.from < table.to)) return false;
		if (node.name !== 'HTMLBlock' && node.name !== 'FencedCode') return;
		const mermaid = node.name === 'FencedCode';
		const info = node.node.getChild('CodeInfo');
		if (mermaid && (!info || source.slice(info.from, info.to).trim().toLowerCase() !== 'mermaid')) return false;
		if (!mermaid && /^<\/?table(?:\s|>)/iu.test(source.slice(node.from))) return false;
		const opening = state.doc.lineAt(node.from);
		const prefix = source.slice(opening.from, node.from);
		const quoteDepth = [...prefix.matchAll(/>/gu)].length;
		const prefixLength = (line: string): number => {
			if (!quoteDepth) return line.startsWith(prefix) ? prefix.length : 0;
			let offset = 0;
			for (let index = 0; index < quoteDepth; index++) {
				const quote = /^ {0,3}> ?/u.exec(line.slice(offset));
				if (!quote) break;
				offset += quote[0].length;
			}
			return offset;
		};
		const to = node.to;
		const closing = mermaid ? node.node.getChildren('CodeMark')[1] : null;
		const first = opening.number + (mermaid ? 1 : 0);
		const last = closing ? state.doc.lineAt(closing.from).number - 1 : state.doc.lineAt(to).number;
		const lines: RenderedBlock['lines'] = [];
		for (let index = first; index <= last; index++) {
			const line = state.doc.line(index);
			lines.push({ from: line.from, contentFrom: line.from + prefixLength(line.text), to: Math.min(line.to, to), number: index - first + 1 });
		}
		const bodyFrom = lines[0]?.contentFrom ?? opening.to;
		const bodyTo = lines.at(-1)?.to ?? bodyFrom;
		const markdown = source.slice(opening.from, to).split('\n').map(line => line.slice(prefixLength(line))).join('\n');
		blocks.push({ kind: mermaid ? 'mermaid' : 'html', from: opening.from, to, bodyFrom, bodyTo, lines, source: markdown,
			fence: closing ? { openingTo: opening.to, closingFrom: state.doc.lineAt(closing.from).from, continuation: prefix } : null });
		return false;
	} });
	cache.set(state.doc, blocks);
	return blocks;
}

export interface HtmlSourceToken { from: number; to: number; kind: 'tag' | 'attribute' | 'string' | 'punctuation' | 'comment' }
export function htmlSourceTokens(source: string): HtmlSourceToken[] {
	const tokens: HtmlSourceToken[] = [];
	for (const tag of source.matchAll(tagPattern)) {
		const at = tag.index;
		if (tag[0].startsWith('<!--')) { tokens.push({ from: at, to: at + tag[0].length, kind: 'comment' }); continue; }
		const opening = /^<(\/?)([\w:-]+)/u.exec(tag[0])!;
		tokens.push({ from: at, to: at + 1 + opening[1]!.length, kind: 'punctuation' },
			{ from: at + 1 + opening[1]!.length, to: at + opening[0].length, kind: 'tag' });
		const tail = /\/?>(?:$)/u.exec(tag[0])!;
		tokens.push({ from: at + tail.index, to: at + tag[0].length, kind: 'punctuation' });
		const attributes = tag[0].slice(opening[0].length, tail.index);
		for (const attr of attributes.matchAll(/([^\s=]+)(?:\s*(=)\s*("[^"]*"|'[^']*'|[^\s]+))?/gu)) {
			const start = at + opening[0].length + attr.index;
			tokens.push({ from: start, to: start + attr[1]!.length, kind: 'attribute' });
			if (attr[2]) {
				const equal = start + attr[0].indexOf('=');
				tokens.push({ from: equal, to: equal + 1, kind: 'punctuation' });
				const valueFrom = start + attr[0].lastIndexOf(attr[3]!);
				tokens.push({ from: valueFrom, to: valueFrom + attr[3]!.length, kind: 'string' });
			}
		}
	}
	return tokens.sort((a, b) => a.from - b.from);
}
