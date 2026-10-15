import { parser, GFM } from '@lezer/markdown';

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
	function contexts(input: string): void {
		opaque.length = containers.length = 0;
		grammar.parse(input).iterate({ enter(node) {
			if (/^(?:InlineCode|FencedCode|CodeBlock|HTMLBlock|HTMLTag|CommentBlock|Comment)$/u.test(node.name)) opaque.push({ from: node.from, to: node.to });
			if (node.name === 'ListItem') containers.push({ from: node.from, to: node.to });
		} });
		const metadata = /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?(?:\r?\n(?:---|\.\.\.)[ \t]*(?=\r?\n|$)|$)/u.exec(input);
		if (metadata) opaque.push({ from: 0, to: metadata[0].length });
		for (let from = input.indexOf('%%'); from >= 0;) {
			const hidden = opaque.find(range => range.from <= from && from < range.to);
			if (hidden) { from = input.indexOf('%%', hidden.to); continue; }
			const closing = input.indexOf('%%', from + 2), to = closing < 0 ? input.length : closing + 2;
			opaque.push({ from, to });
			from = input.indexOf('%%', to);
		}
		opaque.sort((a, b) => a.from - b.from);
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
	const expressions: MathExpression[] = [], candidates: MathRange[] = [];
	let rowIndex = 0;
	for (let at = 0; at < source.length;) {
		while (rows[rowIndex]!.to < at) rowIndex++;
		if (source[at] !== '$' || escaped(source, at)) { at++; continue; }
		const hidden = opaque.find(range => range.from <= at && at < range.to);
		if (hidden) { at = hidden.to; continue; }
		const end = runEnd(source, at), width = end - at;
		if (width > 2) { at = end; continue; }
		const row = rows[rowIndex]!, double = width === 2;
		const owner = containers.filter(range => range.from <= at && at < range.to).at(-1);
		const listPrefix = owner && owner.from >= row.from && /^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?$/u.test(source.slice(row.body, at));
		const standalone = double && at === row.body && !source.slice(end, row.to).trim();
		const blockStart = at === row.body || !!listPrefix;
		const multiline = double && blockStart && (!source.slice(end, row.to).trim() || !!source[end] && !/\s/u.test(source[end]));
		// Only a structural opening fence owns following rows; prose dollars stay on their row.
		let limit = multiline ? source.length : row.to;
		if (owner) limit = Math.min(limit, owner.to);
		if (double) for (let next = rowIndex + 1; next < rows.length; next++) {
			if (rows[next]!.depth < row.depth) { limit = Math.min(limit, rows[next - 1]!.to); break; }
		}
		if (!double && (!source[end] || /\s/u.test(source[end]))) { at = end; continue; }
		let close = -1;
		for (let search = end; search < limit;) {
			if (source[search] !== '$' || escaped(source, search)) { search++; continue; }
			const stop = runEnd(source, search), size = stop - search;
			const closingRow = rows.find(item => item.from <= search && search <= item.to)!;
			if (double && closingRow.depth !== row.depth) { search = stop; continue; }
			// A close may share its run with the next opener, but an unowned run never opens math.
			const nextWidth = size - width;
			const adjacent = nextWidth === 0 || nextWidth === 1 && !!source[stop] && !/\s/u.test(source[stop]) || nextWidth === 2;
			if (size >= width && size <= width + 2 && adjacent && (double || !/\s/u.test(source[search - 1]!) && !/\d/u.test(source[search + width] ?? ''))) { close = search; break; }
			if (!double) break;
			search = stop;
		}
		if (close >= 0 && close > end) {
			const closingRow = rows.find(item => item.from <= close && close <= item.to)!;
			const display = double && blockStart && !source.slice(end, row.to).trim() &&
				close === closingRow.body && !source.slice(close + width, closingRow.to).trim();
			const math = { from: at, to: close + width, contentFrom: end, contentTo: close, display };
			expressions.push(math);
			if (standalone) candidates.push(math);
			// A fence/comment begun inside TeX must not claim the following Markdown.
			if (opaque.some(range => math.from < range.from && range.from < math.to)) {
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
