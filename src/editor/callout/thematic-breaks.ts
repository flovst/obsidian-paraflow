import type { EditorState } from '@codemirror/state';
import { discoverParagraphAuthority } from '../paragraph/syntax.js';
import type { ThematicBreakRange } from '../paragraph/thematic-break-projection.js';
import { quoteContainers } from './presentation-model.js';
import { projectQuoteContent } from './projection.js';

const cache = new WeakMap<EditorState, readonly ThematicBreakRange[]>();

export function calloutThematicBreaks(state: EditorState): readonly ThematicBreakRange[] {
	const cached = cache.get(state);
	if (cached) return cached;
	const ranges = new Map<number, ThematicBreakRange>();
	for (const card of quoteContainers(state)) {
		const content = projectQuoteContent(state, card.kind === 'callout' ? card.headerTo + 1 : card.from, card.to, card.depth);
		if (!content) continue;
		for (const block of discoverParagraphAuthority(content.state).blocks) {
			if (block.kind !== 'thematic-break') continue;
			const from = content.toSource(block.from);
			ranges.set(from, { from, to: content.toSource(block.to) });
		}
	}
	const result = [...ranges.values()].sort((a, b) => a.from - b.from);
	cache.set(state, result);
	return result;
}
