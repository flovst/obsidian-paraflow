import { parser, GFM } from '@lezer/markdown';
import { createRangeQuery } from './range-query.js';

export interface MathExpression {
	readonly from: number;
	readonly to: number;
	readonly contentFrom: number;
	readonly contentTo: number;
	readonly display: boolean;
}
export interface MathRange { readonly from: number; readonly to: number }
export interface MathRangeIndex {
	readonly expressions: readonly MathExpression[];
	readonly candidates: readonly MathRange[];
	readonly opaque: readonly MathRange[];
}
const grammar = parser.configure(GFM);

function escaped(source: string, at: number): boolean {
	let count = 0;
	while (at > 0 && source[--at] === '\\') count++;
	return count % 2 === 1;
}
function runEnd(source: string, from: number): number {
	let to = from;
	while (source[to] === '$') to++;
	return to;
}

/** Dollar grammar is owned here, independently of any host math parser. */
export function scanMathRanges(source: string): MathRangeIndex {
	const opaque: MathRange[] = [], containers: MathRange[] = [];
	let opaqueQuery = createRangeQuery(opaque), containerQuery = createRangeQuery(containers);
	function contexts(input: string): void {
		opaque.length = containers.length = 0;
		grammar.parse(input).iterate({ enter(node) {
			if (/^(?:InlineCode|FencedCode|CodeBlock|HTMLBlock|HTMLTag|CommentBlock|Comment)$/u.test(node.name)) opaque.push({ from: node.from, to: node.to });
			if (node.name === 'ListItem') containers.push({ from: node.from, to: node.to });
		} });
		const nativeOpaque = createRangeQuery(opaque);
		const metadata = /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?(?:\r?\n(?:---|\.\.\.)[ \t]*(?=\r?\n|$)|$)/u.exec(input);
		if (metadata) opaque.push({ from: 0, to: metadata[0].length });
		for (let from = input.indexOf('%%'); from >= 0;) {
			// Native ranges precede the appended metadata range in the original first-match order.
			const hidden = nativeOpaque.firstContainingPoint(from) ?? (metadata && from < metadata[0].length ? { to: metadata[0].length } : undefined);
			if (hidden) { from = input.indexOf('%%', hidden.to); continue; }
			const closing = input.indexOf('%%', from + 2), to = closing < 0 ? input.length : closing + 2;
			opaque.push({ from, to });
			from = input.indexOf('%%', to);
		}
		opaque.sort((a, b) => a.from - b.from);
		opaqueQuery = createRangeQuery(opaque);
		containerQuery = createRangeQuery(containers);
	}
	contexts(source);
	let contextSource = source;
	const rows: { from: number; to: number; body: number; depth: number }[] = [];
	let offset = 0;
	for (const text of source.split('\n')) {
		const prefix = /^[ \t]*(?:>[ \t]*)*/u.exec(text)![0];
		rows.push({ from: offset, to: offset + text.length, body: offset + prefix.length, depth: (prefix.match(/>/gu) ?? []).length });
		offset += text.length + 1;
	}
	const shallowerLimit = Array<number>(rows.length).fill(source.length), following: number[] = [];
	for (let index = rows.length - 1; index >= 0; index--) {
		while (following.length && rows[following.at(-1)!]!.depth >= rows[index]!.depth) following.pop();
		const next = following.at(-1);
		if (next !== undefined) shallowerLimit[index] = rows[next - 1]!.to;
		following.push(index);
	}
	function rowAt(position: number): typeof rows[number] {
		let first = 0, last = rows.length;
		while (first + 1 < last) {
			const middle = (first + last) >>> 1;
			if (rows[middle]!.from <= position) first = middle;
			else last = middle;
		}
		return rows[first]!;
	}
	const expressions: MathExpression[] = [], candidates: MathRange[] = [];
	let rowIndex = 0;
	for (let at = 0; at < source.length;) {
		while (rows[rowIndex]!.to < at) rowIndex++;
		if (source[at] !== '$' || escaped(source, at)) { at++; continue; }
		const hidden = opaqueQuery.firstContainingPoint(at);
		if (hidden) { at = hidden.to; continue; }
		const end = runEnd(source, at), width = end - at;
		if (width > 2) { at = end; continue; }
		const row = rows[rowIndex]!, double = width === 2;
		const owner = containerQuery.lastContainingPoint(at);
		const listPrefix = owner && owner.from >= row.from && /^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?$/u.test(source.slice(row.body, at));
		const standalone = double && at === row.body && !source.slice(end, row.to).trim();
		const blockStart = at === row.body || !!listPrefix;
		const multiline = double && blockStart && (!source.slice(end, row.to).trim() || !!source[end] && !/\s/u.test(source[end]));
		// Only a structural opening fence owns following rows; prose dollars stay on their row.
		let limit = multiline ? source.length : row.to;
		if (owner) limit = Math.min(limit, owner.to);
		if (double) limit = Math.min(limit, shallowerLimit[rowIndex]!);
		if (!double && (!source[end] || /\s/u.test(source[end]))) { at = end; continue; }
		let close = -1;
		for (let search = end; search < limit;) {
			if (source[search] !== '$' || escaped(source, search)) { search++; continue; }
			const stop = runEnd(source, search), size = stop - search;
			const closingRow = rowAt(search);
			if (double && closingRow.depth !== row.depth) { search = stop; continue; }
			// A close may share its run with the next opener, but an unowned run never opens math.
			const nextWidth = size - width;
			const adjacent = nextWidth === 0 || nextWidth === 1 && !!source[stop] && !/\s/u.test(source[stop]) || nextWidth === 2;
			if (size >= width && size <= width + 2 && adjacent && (double || !/\s/u.test(source[search - 1]!) && !/\d/u.test(source[search + width] ?? ''))) { close = search; break; }
			if (!double) break;
			search = stop;
		}
		if (close >= 0 && close > end) {
			const closingRow = rowAt(close);
			const display = double && blockStart && !source.slice(end, row.to).trim() &&
				close === closingRow.body && !source.slice(close + width, closingRow.to).trim();
			const math = { from: at, to: close + width, contentFrom: end, contentTo: close, display };
			expressions.push(math);
			if (standalone) candidates.push(math);
			// A fence/comment begun inside TeX must not claim the following Markdown.
			if (opaqueQuery.firstStartingBetween(math.from, math.to)) {
				contextSource = contextSource.slice(0, math.from) + contextSource.slice(math.from, math.to).replace(/[^\r\n]/g, 'x') + contextSource.slice(math.to);
				contexts(contextSource);
			}
			at = math.to;
		} else {
			if (standalone) candidates.push({ from: at, to: limit });
			at = end;
		}
	}
	return { expressions, candidates, opaque };
}
