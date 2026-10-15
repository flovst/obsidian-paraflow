import { GFM, parser, type MarkdownConfig } from '@lezer/markdown';

export interface FootnoteRange { readonly from: number; readonly to: number }
export interface FootnoteReference extends FootnoteRange {
	readonly id: string;
	readonly number: number;
	readonly occurrence: number;
	readonly status: 'resolved' | 'missing' | 'duplicate';
}
export interface FootnoteDefinition extends FootnoteRange {
	readonly id: string;
	readonly number: number | null;
	readonly status: 'resolved' | 'duplicate' | 'orphan';
	readonly references: readonly FootnoteReference[];
}
export interface FootnoteIndex {
	readonly references: readonly FootnoteReference[];
	readonly definitions: readonly FootnoteDefinition[];
	readonly inlineCount: number;
	readonly inlineNotes: readonly (FootnoteRange & { readonly number: number })[];
}

/** Read a definition's text without absorbing the following ordinary paragraph. */
export function footnoteDefinitionContent(source: string, definition: FootnoteDefinition): string {
	const lineStart = source.lastIndexOf('\n', definition.from - 1) + 1;
	const prefix = source.slice(lineStart, definition.from);
	const lines = source.slice(definition.to).split(/\r?\n/u);
	const content = [lines[0]!.trimStart()];
	let pendingBlank = 0;
	for (const raw of lines.slice(1)) {
		if (prefix && !raw.startsWith(prefix)) break;
		const line = raw.slice(prefix.length);
		if (!line.trim()) { pendingBlank++; continue; }
		const match = /^(?: {4}|\t)(.*)$/u.exec(line);
		if (!match) break;
		while (pendingBlank-- > 0) content.push('');
		pendingBlank = 0;
		content.push(match[1]!);
	}
	return content.join('\n').trimEnd();
}

const definitionPattern = /^\[\^([^\s[\]]+)\]:/u;

function mathClose(text: string, start: number, width: number): number {
	for (let pos = start; pos < text.length; pos += 1) {
		if (text[pos] === '\\') { pos += 1; continue; }
		if (text[pos] !== '$') continue;
		if (width === 2) { if (text[pos + 1] === '$') return pos; continue; }
		// A failed single-dollar closer cannot be crossed to pair separate currency amounts.
		return /\s/u.test(text[pos - 1] ?? '') || /\d/u.test(text[pos + 1] ?? '') ? -1 : pos;
	}
	return -1;
}

function codeSpanEnd(text: string): number {
	let width = 1;
	while (text[width] === '`') width += 1;
	for (let pos = width; pos < text.length; pos += 1) {
		if (text[pos] !== '`') continue;
		let end = pos + 1;
		while (text[end] === '`') end += 1;
		if (end - pos === width) return end;
		pos = end - 1;
	}
	return -1;
}

const footnoteGrammar: MarkdownConfig = {
	defineNodes: ['ParaflowReference', 'ParaflowInlineNote', 'ParaflowComment', 'ParaflowInlineMath',
		'ParaflowDefinitionMarker', { name: 'ParaflowDefinition', block: true },
		{ name: 'ParaflowMetadata', block: true }, { name: 'ParaflowBlockMath', block: true }],
	parseBlock: [{
		name: 'ParaflowBlockMath', before: 'FencedCode',
		parse(cx, line) {
			if (line.indent >= line.baseIndent + 4 || !line.text.startsWith('$$', line.pos) ||
				mathClose(line.text, line.pos + 2, 2) >= 0) return false;
			const start = cx.lineStart + line.pos;
			while (cx.nextLine()) {
				if (mathClose(line.text, line.pos, 2) < 0) continue;
				const end = cx.lineStart + line.text.length;
				cx.nextLine();
				cx.addElement(cx.elt('ParaflowBlockMath', start, end));
				return true;
			}
			cx.addElement(cx.elt('ParaflowBlockMath', start, cx.prevLineEnd()));
			return true;
		},
		endLeaf: (_cx, line) => line.text.startsWith('$$', line.pos),
	}, {
		name: 'ParaflowMetadata', before: 'HorizontalRule',
		parse(cx, line) {
			if (cx.lineStart !== 0 || line.text !== '---') return false;
			const start = cx.lineStart;
			while (cx.nextLine()) {
				if (line.text === '---' || line.text === '...') {
					const end = cx.lineStart + line.text.length;
					cx.nextLine();
					cx.addElement(cx.elt('ParaflowMetadata', start, end));
					return true;
				}
			}
			cx.addElement(cx.elt('ParaflowMetadata', start, cx.prevLineEnd()));
			return true;
		},
	}, {
		name: 'ParaflowDefinition', before: 'LinkReference',
		parse(cx, line) {
			if (line.indent >= line.baseIndent + 4) return false;
			const match = definitionPattern.exec(line.text.slice(line.pos));
			if (!match) return false;
			const from = cx.lineStart + line.pos;
			const to = from + match[0].length;
			const end = cx.lineStart + line.text.length;
			const children = [cx.elt('ParaflowDefinitionMarker', from, to),
				...cx.parser.parseInline(line.text.slice(line.pos + match[0].length), to)];
			cx.nextLine();
			cx.addElement(cx.elt('ParaflowDefinition', from, end, children));
			return true;
		},
		endLeaf: (_cx, line) => definitionPattern.test(line.text.slice(line.pos)),
	}],
	parseInline: [{
		name: 'ParaflowInlineMath', before: 'Link',
		parse(cx, next, pos) {
			if (next !== 36) return -1;
			const width = cx.char(pos + 1) === 36 ? 2 : 1;
			if (width === 1 && /\s/u.test(cx.slice(pos + 1, pos + 2))) return -1;
			const close = mathClose(cx.slice(pos, cx.end), width, width);
			return close < 0 ? -1 : cx.addElement(cx.elt('ParaflowInlineMath', pos, pos + close + width));
		},
	}, {
		name: 'ParaflowComment', before: 'Link',
		parse(cx, next, pos) {
			if (next !== 37 || cx.char(pos + 1) !== 37) return -1;
			return cx.addElement(cx.elt('ParaflowComment', pos, pos + 2));
		},
	}, {
		name: 'ParaflowReference', before: 'Link',
		parse(cx, next, pos) {
			if (next !== 91 || cx.char(pos + 1) !== 94) return -1;
			const match = /^\[\^([^\s[\]]+)\]/u.exec(cx.slice(pos, cx.end));
			return match ? cx.addElement(cx.elt('ParaflowReference', pos, pos + match[0].length)) : -1;
		},
	}, {
		name: 'ParaflowInlineNote', before: 'Link',
		parse(cx, next, pos) {
			if (next !== 94 || cx.char(pos + 1) !== 91) return -1;
			let depth = 1;
			for (let end = pos + 2; end < cx.end; end += 1) {
				const char = cx.char(end);
				if (char === 92) { end += 1; continue; }
				if (char === 96) {
					const codeEnd = codeSpanEnd(cx.slice(end, cx.end));
					if (codeEnd >= 0) { end += codeEnd - 1; continue; }
				}
				if (char === 91) depth += 1;
				if (char === 93 && --depth === 0) {
					return cx.addElement(cx.elt('ParaflowInlineNote', pos, end + 1));
				}
			}
			return -1;
		},
	}],
};

const footnoteParser = parser.configure([GFM, footnoteGrammar]);

/** The Lezer grammar identifies inline text; code, HTML and destinations never enter the scanner. */
export function buildFootnoteIndex(source: string): FootnoteIndex {
	const references: Array<FootnoteRange & { id: string; number: number; occurrence: number }> = [];
	const definitions: Array<FootnoteRange & { id: string }> = [];
	const numbers = new Map<string, number>();
	const occurrences = new Map<string, number>();
	let nextNumber = 1;
	let inlineCount = 0;
	const inlineNotes: Array<FootnoteRange & { number: number }> = [];
	let commentEnd = -1;
	const htmlTags: string[] = [];
	footnoteParser.parse(source).iterate({ enter(node) {
		if (node.from < commentEnd && node.to <= commentEnd && node.name !== 'Document') return false;
		if (node.name === 'ParaflowComment') {
			if (htmlTags.length) return false;
			// A syntax-authorized opener may span multiple Markdown blocks.
			const close = source.indexOf('%%', node.to);
			commentEnd = close < 0 ? source.length : close + 2;
			return false;
		}
		if (node.name === 'HTMLTag') {
			const text = source.slice(node.from, node.to);
			const tag = /^<\/?([a-z][a-z0-9-]*)\b/iu.exec(text)?.[1]?.toLowerCase();
			if (tag && text.startsWith('</')) {
				const open = htmlTags.lastIndexOf(tag);
				if (open >= 0) htmlTags.splice(open);
			} else if (tag && !text.endsWith('/>') && !['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
				'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(tag)) htmlTags.push(tag);
			return false;
		}
		if (htmlTags.length && ['ParaflowReference', 'ParaflowInlineNote', 'ParaflowDefinitionMarker'].includes(node.name)) return false;
		if (node.name === 'ParaflowInlineNote') {
			inlineNotes.push({from:node.from,to:node.to,number:nextNumber});
			inlineCount += 1; nextNumber += 1; return false;
		}
		if (node.name === 'ParaflowDefinitionMarker') {
			definitions.push({ from: node.from, to: node.to, id: source.slice(node.from + 2, node.to - 2) });
		} else if (node.name === 'ParaflowReference') {
			const id = source.slice(node.from + 2, node.to - 1);
			let number = numbers.get(id);
			if (number === undefined) { number = nextNumber++; numbers.set(id, number); }
			const occurrence = (occurrences.get(id) ?? 0) + 1;
			occurrences.set(id, occurrence);
			references.push({ from: node.from, to: node.to, id, number, occurrence });
		}
		return !['InlineCode', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'HTMLTag', 'Comment',
			'ParaflowComment', 'ParaflowMetadata', 'ParaflowInlineMath', 'ParaflowBlockMath', 'Link', 'Image', 'Autolink', 'LinkReference'].includes(node.name);
	} });
	const definitionCounts = new Map<string, number>();
	for (const definition of definitions) definitionCounts.set(definition.id, (definitionCounts.get(definition.id) ?? 0) + 1);
	const resolvedReferences: FootnoteReference[] = references.map(ref => ({ ...ref,
		status: !definitionCounts.has(ref.id) ? 'missing' : definitionCounts.get(ref.id) === 1 ? 'resolved' : 'duplicate',
	}));
	return { references: resolvedReferences, inlineCount, inlineNotes,
		definitions: definitions.map(def => ({ ...def, number: numbers.get(def.id) ?? null,
			status: definitionCounts.get(def.id)! > 1 ? 'duplicate' : numbers.has(def.id) ? 'resolved' : 'orphan',
			references: resolvedReferences.filter(ref => ref.id === def.id),
		})),
	};
}
