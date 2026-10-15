import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { HeadingBodyLine } from '../paragraph/syntax.js';
import { quoteContainers } from './presentation-model.js';
import { projectQuoteContent } from './projection.js';

const cache = new WeakMap<EditorState, readonly HeadingBodyLine[]>();

/** Containers contribute semantic body offsets; the real editor keeps the single heading state. */
export function calloutHeadingBodyLines(state: EditorState): readonly HeadingBodyLine[] {
	const cached = cache.get(state);
	if (cached) return cached;
	const lines = new Map<number, HeadingBodyLine>();
	for (const card of quoteContainers(state)) {
		const first = state.doc.lineAt(card.from).number + (card.kind === 'callout' ? 1 : 0);
		if (first > state.doc.lineAt(card.to).number) continue;
		const projection = projectQuoteContent(state, state.doc.line(first).from, card.to, card.depth);
		if (!projection) continue;
		const blocks = [];
		for (let node = syntaxTree(projection.state).topNode.firstChild; node; node = node.nextSibling) blocks.push(node);
		for (const line of projection.lines) {
			const block = blocks.find(block => block.from <= line.virtualFrom && line.virtualFrom < block.to);
			if (block ? !/^(?:Paragraph|ATXHeading[1-6])$/u.test(block.name) : line.text.trim()) continue;
			lines.set(line.from, { from: line.from, to: line.from + line.prefix.length + line.text.length,
				bodyFrom: line.from + line.prefix.length });
		}
	}
	const result = [...lines.values()].sort((a, b) => a.from - b.from);
	cache.set(state, result);
	return result;
}
