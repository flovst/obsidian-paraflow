import type { EditorState } from '@codemirror/state';
import type { ContainerBodyLine } from '../runtime/container-body-boundaries.js';
import { getParagraphProjectionState } from '../paragraph/projection.js';
import { bodyTabDelimiterOffset } from '../literal-tab.js';
import { quoteContainers } from './presentation-model.js';
import { projectQuoteContent } from './projection.js';

const cache = new WeakMap<EditorState, ReadonlyMap<number, ContainerBodyLine>>();

/** Use projected paragraph ownership; code, math, tables and header metadata keep their own boundaries. */
export function calloutBodyLine(state: EditorState, position: number): ContainerBodyLine | null {
	let lines = cache.get(state);
	if (!lines) {
		const result = new Map<number, ContainerBodyLine>();
		for (const card of quoteContainers(state)) {
			const first = state.doc.lineAt(card.from).number + (card.kind === 'callout' ? 1 : 0);
			if (first > state.doc.lineAt(card.to).number) continue;
			const projection = projectQuoteContent(state, state.doc.line(first).from, card.to, card.depth);
			if (!projection) continue;
			const { authority, rangeIndex } = getParagraphProjectionState(projection.state)!;
			for (const line of projection.lines) {
				const to = line.virtualFrom + line.text.length;
				const paragraph = authority.paragraphs.some(block => block.from <= to && line.virtualFrom <= block.to);
				const anchor = rangeIndex.editableAnchors.find(anchor => line.virtualFrom <= anchor && anchor <= to);
				if (!paragraph && anchor === undefined) continue;
				const bodyFrom = line.from + line.prefix.length + (paragraph && bodyTabDelimiterOffset(line.text) === 0 ? 1 : 0);
				result.set(line.from, { from: line.from, to: line.from + line.prefix.length + line.text.length, bodyFrom,
					emptyAnchor: line.text.length === 0 && anchor !== undefined ? projection.toSource(anchor) : null });
			}
		}
		lines = result;
		cache.set(state, lines);
	}
	return lines.get(state.doc.lineAt(position).from) ?? null;
}
