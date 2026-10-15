import { GFM, parser } from '@lezer/markdown';

export interface ShorthandSettings { readonly subscript: boolean; readonly superscript: boolean }
export interface ShorthandRange { readonly from: number; readonly to: number; readonly kind: 'subscript' | 'superscript' }
export interface TildePart {
	readonly from: number; readonly to: number; readonly bodyFrom: number; readonly bodyTo: number;
	readonly kind: 'subscript' | 'strikethrough';
}
export interface TildeRun { readonly from: number; readonly to: number; readonly parts: readonly TildePart[] }

const markdown = parser.configure(GFM);
const opaqueNodes = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'Comment',
	'Strikethrough', 'URL', 'Autolink', 'LinkTitle', 'Image']);

function escaped(source: string, position: number): boolean {
	let count = 0;
	while (position > 0 && source[--position] === '\\') count++;
	return count % 2 === 1;
}

/** Source-only discovery keeps host syntax trees and rendered text out of the note format. */
function sourceMask(source: string, includeStrike: boolean): Uint8Array {
	const blocked = new Uint8Array(source.length);
	const html: Array<{ tag: string; from: number }> = [];
	markdown.parse(source).iterate({ enter(node) {
		if (node.name === 'LinkReference' && source.startsWith('[^', node.from)) return false;
		if ((opaqueNodes.has(node.name) && (includeStrike || node.name !== 'Strikethrough')) || (node.name === 'LinkReference' && !source.startsWith('[^', node.from))) {
			blocked.fill(1, node.from, node.to); return false;
		}
		if (node.name !== 'HTMLTag') return true;
		blocked.fill(1, node.from, node.to);
		const text = source.slice(node.from, node.to);
		const tag = /^<\/?([a-z][\w-]*)/iu.exec(text)?.[1]?.toLowerCase();
		if (!tag) return true;
		if (text.startsWith('</')) {
			const index = html.findLastIndex(item => item.tag === tag);
			if (index >= 0) { blocked.fill(1, html[index]!.from, node.to); html.splice(index); }
		} else if (!text.endsWith('/>') && !['br', 'hr', 'img', 'input', 'wbr'].includes(tag)) {
			html.push({ tag, from: node.from });
		}
		return true;
	} });
	for (const item of html) blocked.fill(1, item.from);
	for (const match of source.matchAll(/\[\^[^\]\r\n]*\]/gu)) blocked.fill(1, match.index, match.index + match[0].length);
	const metadata = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/u.exec(source);
	if (metadata) blocked.fill(1, 0, metadata[0].length);
	for (let position = 0; position < source.length; position++) {
		if (blocked[position] || escaped(source, position)) continue;
		const comment = source.startsWith('%%', position);
		if (!comment && source[position] !== '$') continue;
		const marker = comment ? '%%' : source.startsWith('$$', position) ? '$$' : '$';
		if (marker === '$' && /\s/u.test(source[position + 1] ?? '')) continue;
		let close = position + marker.length;
		while ((close = source.indexOf(marker, close)) >= 0 && escaped(source, close)) close += marker.length;
		if (close < 0 && marker === '$') continue;
		if (marker === '$' && (/\s/u.test(source[close - 1] ?? '') || /\d/u.test(source[close + 1] ?? ''))) continue;
		const end = close < 0 ? source.length : close + marker.length;
		blocked.fill(1, position, end); position = end - 1;
	}
	return blocked;
}

/** A nonempty two-marker pair wins over a one-marker pair; consumed markers are never reused. */
export function discoverTildeRuns(source: string): readonly TildeRun[] {
	const blocked = sourceMask(source, false);
	const ordinaryStrike = sourceMask(source, true);
	const runs: TildeRun[] = [];
	for (let from = 0; from < source.length; from++) {
		if (!source.startsWith('~~~', from) || source[from - 1] === '~' || escaped(source, from) || ordinaryStrike[from]) continue;
		const parts: TildePart[] = [];
		let cursor = from;
		while (source[cursor] === '~' && !blocked[cursor]) {
			let part: TildePart | null = null;
			for (const width of [2, 1]) {
				if (!source.startsWith('~'.repeat(width), cursor)) continue;
				for (let close = cursor + width + 1; close < source.length; close++) {
					if (blocked[close] || /\s/u.test(source[close]!) || /[\r\n]/u.test(source.slice(cursor, close))) break;
					if (source[close] === '\\') { close++; continue; }
					if (!source.startsWith('~'.repeat(width), close) || blocked[close + width - 1]) continue;
					part = { from: cursor, to: close + width, bodyFrom: cursor + width, bodyTo: close,
						kind: width === 2 ? 'strikethrough' : 'subscript' };
					break;
				}
				if (part) break;
			}
			if (!part) break;
			parts.push(part); cursor = part.to;
		}
		while (source[cursor] === '~' && !blocked[cursor]) cursor++;
		if (parts.length) runs.push({ from, to: cursor, parts });
		from = cursor - 1;
	}
	return runs;
}

export function discoverShorthand(source: string): readonly ShorthandRange[] {
	const blocked = sourceMask(source, true);
	for (const run of discoverTildeRuns(source)) blocked.fill(1, run.from, run.to);
	const ranges: ShorthandRange[] = [];
	for (let from = 0; from < source.length; from++) {
		const delimiter = source[from];
		if ((delimiter !== '~' && delimiter !== '^') || blocked[from] || escaped(source, from) ||
			source[from - 1] === delimiter || source[from + 1] === delimiter) continue;
		let valid = true;
		for (let to = from + 1; to < source.length; to++) {
			const character = source[to]!;
			if (character === '\n' || character === '\r' || blocked[to]) break;
			if (character === '\\' && to + 1 < source.length) {
				if (source[to + 1] === '\n' || source[to + 1] === '\r') break;
				to++; continue;
			}
			if (character === delimiter) {
				if (valid && to > from + 1 && source[to + 1] !== delimiter) {
					ranges.push({ from, to: to + 1, kind: delimiter === '~' ? 'subscript' : 'superscript' });
				}
				from = to; break;
			}
			if (/\s/u.test(character)) break;
			if (character === '~' || character === '^' || character === '*' || character === '_' || character === '[' || character === ']') valid = false;
		}
	}
	return ranges;
}
