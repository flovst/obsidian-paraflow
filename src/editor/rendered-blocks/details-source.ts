import { parser } from '@lezer/markdown';
import { metadataGrammar } from '../markdown-grammar.js';

export interface DetailsContainer {
	from: number; to: number; headerTo: number; bodyFrom: number; bodyTo: number;
	closingFrom: number; titleFrom: number; titleTo: number; open: boolean;
}
const grammar = parser.configure(metadataGrammar);
let cachedSource = '', cached: readonly DetailsContainer[] = [];

/** Balanced structural tags keep Markdown body offsets in the primary document. */
export function detailsContainers(source: string): readonly DetailsContainer[] {
	if (!/<details(?:\s|>)/iu.test(source)) return [];
	if (source === cachedSource) return cached;
	const result: DetailsContainer[] = [], opaque: { from: number; to: number }[] = [];
	for (const match of source.matchAll(/<!--[\s\S]*?(?:-->|$)|%%[\s\S]*?(?:%%|$)/gu)) opaque.push({ from: match.index, to: match.index + match[0].length });
	grammar.parse(source).iterate({ enter(node) {
		if (/^(?:FencedCode|CodeBlock|CommentBlock|Comment|CalloutNativeMetadata)$/u.test(node.name)) {
			opaque.push({ from: node.from, to: node.to }); return false;
		}
		return undefined;
	} });
	const stack: { from: number; tagTo: number; open: boolean }[] = [];
	let offset = 0, fence: { marker: string; size: number } | null = null;
	for (const line of source.split('\n')) {
		const at = offset; offset += line.length + 1;
		if (opaque.some(range => range.from <= at && at < range.to)) continue;
		const content = line.replace(/^(?:[ \t]*>[ \t]?)+/u, '').trimStart();
		const code = /^(`{3,}|~{3,})(.*)$/u.exec(content);
		if (code) {
			if (!fence) fence = { marker: code[1]![0]!, size: code[1]!.length };
			else if (code[1]![0] === fence.marker && code[1]!.length >= fence.size && !code[2]!.trim()) fence = null;
			continue;
		}
		if (fence) continue;
		for (const token of line.matchAll(/<\/?details\b(?:"[^"]*"|'[^']*'|[^'">])*>/giu)) {
			const from = at + token.index, to = from + token[0].length;
			if (opaque.some(range => range.from <= from && from < range.to)) continue;
			if (token[0].startsWith('</')) {
				if (!/^(?:[ \t]|>)*$/u.test(line.slice(0, token.index)) || line.slice(token.index + token[0].length).trim()) continue;
				const opening = stack.pop();
				if (!opening) continue;
				const summary = /^(?:[ \t\r\n]|>)*<summary\b[^>]*>([\s\S]*?)<\/summary[ \t]*>/iu.exec(source.slice(opening.tagTo, from));
				if (!summary) continue;
				const summaryTag = /<summary\b[^>]*>/iu.exec(summary[0])!;
				const titleOffset = summaryTag.index + summaryTag[0].length;
				const headerTo = opening.tagTo + summary[0].length, endLine = source.indexOf('\n', headerTo);
				if (source.slice(headerTo, endLine < 0 ? source.length : endLine).trim()) continue;
				const lineFrom = source.lastIndexOf('\n', opening.from - 1) + 1;
				const closingFrom = source.lastIndexOf('\n', from - 1) + 1;
				result.push({ from: lineFrom, to, headerTo, bodyFrom: headerTo + 1, bodyTo: closingFrom,
					closingFrom, titleFrom: opening.tagTo + titleOffset, titleTo: opening.tagTo + summary[0].lastIndexOf('</'), open: opening.open });
			} else if (/^(?:[ \t]|>)*$/u.test(source.slice(at, from))) {
				stack.push({ from, tagTo: to, open: /\sopen(?:\s|=|>)/iu.test(token[0]) });
			}
		}
	}
	result.sort((a, b) => a.from - b.from || b.to - a.to);
	cachedSource = source; cached = result;
	return result;
}

/** Structure is projected separately; spaces preserve every body source coordinate. */
export function detailsMarkdownSource(source: string): string {
	const ranges = detailsContainers(source).flatMap(block => [
		{ from: block.from, to: block.headerTo }, { from: block.closingFrom, to: block.to },
	]).sort((a, b) => a.from - b.from);
	let result = '', cursor = 0;
	for (const range of ranges) {
		result += source.slice(cursor, range.from) + source.slice(range.from, range.to).split('\n').map(line => {
			const prefix = /^(?:[ \t]*>[ \t]?)+/u.exec(line)?.[0] ?? '';
			// Parser offsets count UTF-16 units, including both halves of an emoji.
			return prefix + line.slice(prefix.length).replace(/[^\r]/g, ' ');
		}).join('\n');
		cursor = range.to;
	}
	return result + source.slice(cursor);
}

/** Projected quote bodies retain the same tag masks and source coordinates. */
export function detailsSourceMasks(source: string): { from: number; to: number; fill: ' ' }[] {
	const normalized = detailsMarkdownSource(source), masks: { from: number; to: number; fill: ' ' }[] = [];
	if (normalized === source) return masks;
	for (let from = 0; from < source.length; from++) {
		if (source[from] === normalized[from]) continue;
		let to = from + 1;
		while (to < source.length && source[to] !== normalized[to]) to++;
		masks.push({ from, to, fill: ' ' }); from = to - 1;
	}
	return masks;
}
