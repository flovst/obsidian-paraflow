import type { MarkdownConfig } from '@lezer/markdown';
import type { PendingMathRange } from './math/candidate-ranges.js';
import type { MathExpression } from './math/range-scanner.js';

/** A standalone line break remains editable paragraph content, not an HTML block. */
export const standaloneBreakGrammar: MarkdownConfig = {
	defineNodes: [{ name: 'StandaloneBreaks', block: true }],
	parseBlock: [{ name: 'StandaloneBreaks', before: 'HTMLBlock', parse(context, line) {
		if (line.indent >= line.baseIndent + 4 || !/^(?:<br[ \t]*\/?[ \t]*>[ \t]*)+$/iu.test(line.text.slice(line.pos))) return false;
		context.addElement(context.elt('StandaloneBreaks', context.lineStart + line.pos, context.lineStart + line.text.length));
		context.nextLine();
		return true;
	} }],
};

/** Obsidian admits an ordered list at any starting number after a paragraph. */
export const containerListGrammar: MarkdownConfig = {
	parseBlock: [{ name: 'ContainerOrderedListBoundary', parse: () => false,
		endLeaf: (_context, line) => /^\d{1,9}[.)][ \t]+/u.test(line.text.slice(line.pos)) }],
};

function closingToken(text: string, start: number, token: string): number {
	for (let position = start; position < text.length; position += 1) {
		if (text[position] === '\\') { position += 1; continue; }
		if (text.startsWith(token, position)) return position;
	}
	return -1;
}

export function nativeInlineGrammarFor(expressions: readonly MathExpression[], pending: readonly PendingMathRange[] = []): MarkdownConfig {
	const math = new Map(expressions.filter(expression => !pending.some(range => range.from <= expression.from && expression.from <= range.to))
		.map(expression => [expression.from, expression]));
	return {
	defineNodes: ['CalloutNativeInline', { name: 'CalloutNativeBlock', block: true }],
	parseBlock: [{
		name: 'CalloutNativeBlock', before: 'FencedCode',
		parse(context, line) {
			const from = context.lineStart + line.pos;
			const expression = math.get(from);
			if (expression?.display && expression.to > context.lineStart + line.text.length) {
				while (context.lineStart + line.text.length < expression.to && context.nextLine()) { /* Consume only the scanner-owned rows. */ }
				context.addElement(context.elt('CalloutNativeBlock', from, expression.to));
				context.nextLine();
				return true;
			}
			if (!line.text.startsWith('%%', line.pos) || line.indent >= line.baseIndent + 4 || closingToken(line.text, line.pos + 2, '%%') >= 0) return false;
			while (context.nextLine()) {
				if (closingToken(line.text, line.pos, '%%') < 0) continue;
				const to = context.lineStart + line.text.length;
				context.nextLine();
				context.addElement(context.elt('CalloutNativeBlock', from, to));
				return true;
			}
			context.addElement(context.elt('CalloutNativeBlock', from, context.prevLineEnd()));
			return true;
		},
		endLeaf: (context, line) => math.get(context.lineStart + line.pos)?.display === true || line.text.startsWith('%%', line.pos),
	}],
	parseInline: [{
		name: 'CalloutNativeInline', before: 'Link',
		parse(context, next, position) {
			if (next === 36) {
				const expression = math.get(position);
				return expression && expression.to <= context.end ? context.addElement(context.elt('CalloutNativeInline', position, expression.to)) : -1;
			}
			if (next !== 37 || context.char(position + 1) !== 37) return -1;
			const close = closingToken(context.slice(position, context.end), 2, '%%');
			return close < 0 ? -1 : context.addElement(context.elt('CalloutNativeInline', position, position + close + 2));
		},
	}],
}; }

export const metadataGrammar: MarkdownConfig = {
	defineNodes: [{ name: 'CalloutNativeMetadata', block: true }],
	parseBlock: [{
		name: 'CalloutNativeMetadata', before: 'HorizontalRule',
		parse(context, line) {
			if (context.lineStart !== 0 || line.text !== '---') return false;
			while (context.nextLine()) {
				if (line.text !== '---' && line.text !== '...') continue;
				const to = context.lineStart + line.text.length;
				context.nextLine();
				context.addElement(context.elt('CalloutNativeMetadata', 0, to));
				return true;
			}
			context.addElement(context.elt('CalloutNativeMetadata', 0, context.prevLineEnd()));
			return true;
		},
	}],
};
