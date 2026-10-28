import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { GFM, parser } from '@lezer/markdown';
import { calloutCards, quoteContainers, type CalloutCard } from './callout/presentation-model.js';
import { quotePrefix } from './callout/prefix.js';

export const calloutMenuTypes = [
	{ type: 'info', title: '信息', icon: 'info' },
	{ type: 'important', title: '重要', icon: 'flame' },
	{ type: 'tip', title: '提示', icon: 'lightbulb' },
	{ type: 'success', title: '完成', icon: 'check' },
	{ type: 'question', title: '问题', icon: 'help-circle' },
	{ type: 'warning', title: '警告', icon: 'triangle-alert' },
	{ type: 'example', title: '示例', icon: 'list' },
	{ type: 'quote', title: '引用', icon: 'quote' },
] as const;

export function calloutAtMenuPosition(state: EditorState, position: number): CalloutCard | null {
	return calloutCards(state).filter(card => card.from <= position && position <= card.to)
		.sort((a, b) => b.depth - a.depth)[0] ?? null;
}

/** Only the type token changes; custom titles, metadata and folding retain their source. */
export function calloutTypeChange(state: EditorState, card: CalloutCard, type: string): TransactionSpec {
	if (type && !/^[\p{L}\p{N}_-]+$/u.test(type)) throw new Error('Callout 类型请使用字母、数字、连字符或下划线。');
	const line = state.doc.lineAt(card.from);
	const prefix = quotePrefix(line.text, card.depth)!;
	const start = line.from + prefix.length;
	const token = /^\[!([^|\]]+)(?:\|[^\]]*)?\][+-]?[ \t]*/u.exec(line.text.slice(prefix.length))!;
	const changes = type
		? { from: start + 2, to: start + 2 + token[1]!.length, insert: type.toLowerCase() }
		: { from: start, to: start + token[0].length, insert: '' };
	return { changes, userEvent: 'input.callout-type' };
}

/** Converts the selected paragraphs into one callout, retaining an existing quote level. */
export function convertSelectionToCallout(state: EditorState): TransactionSpec | null {
	const selection = state.selection.main;
	if (calloutAtMenuPosition(state, selection.head)) return null;
	let from = selection.from, to = selection.to;
	let containerPrefix: string | null = null;
	if (selection.empty) {
		const quote = quoteContainers(state).filter(card => card.from <= from && from <= card.to).sort((a, b) => b.depth - a.depth)[0];
		if (quote) { from = quote.from; to = quote.to; containerPrefix = quotePrefix(state.doc.lineAt(from).text, quote.depth); }
		else {
			let node = parser.configure(GFM).parse(state.doc.toString()).resolveInner(from, 1);
			while (node.parent && node.name !== 'Paragraph') node = node.parent;
			if (node.name === 'Paragraph') { from = node.from; to = node.to; }
		}
	}
	const first = state.doc.lineAt(from);
	const last = state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to);
	const lines = state.sliceDoc(first.from, last.to).split('\n');
	const prefix = containerPrefix ?? /^([ \t]*>[ \t]?)/u.exec(lines[0]!)?.[1];
	const quoted = prefix && lines.every(line => line.trim() === '' || line.startsWith(prefix));
	const quote = quoted ? prefix : '> ';
	const body = quoted ? lines.map(line => line || quote).join('\n') : lines.map(line => `> ${line}`).join('\n');
	const insert = `${quote}[!info]\n${body}`;
	return { changes: { from: first.from, to: last.to, insert },
		selection: EditorSelection.cursor(first.from + quote.length + '[!info]'.length), userEvent: 'input.callout' };
}
