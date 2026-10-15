import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { quoteContainers } from './presentation-model.js';
import { projectQuoteContent } from './projection.js';
import { getParagraphProjectionState } from '../paragraph/projection.js';
import { paragraphBoundaryTag } from '../paragraph/model.js';

interface ContainerLayout {
	readonly beforeRows: ReadonlySet<number>;
	readonly boundaries: ReadonlyMap<number, { readonly before: string; readonly after: string }>;
}
const cache = new WeakMap<EditorState, ContainerLayout>();

/** Direct children without a source separator still own a visual boundary. */
export function containerLayout(state: EditorState): ContainerLayout {
	const previous = cache.get(state);
	if (previous) return previous;
	const beforeRows = new Set<number>();
	const boundaries = new Map<number, { before: string; after: string }>();
	for (const card of quoteContainers(state)) {
		const content = projectQuoteContent(state, card.kind === 'callout' ? card.headerTo + 1 : card.from, card.to, card.depth);
		if (!content) continue;
		let precedingTo: number | null = null;
		let precedingTag = '';
		const blocks = getParagraphProjectionState(content.state)!.authority.blocks;
		for (let child = syntaxTree(content.state).topNode.firstChild; child; child = child.nextSibling) {
			const from = content.toSource(child.from);
			const tag = paragraphBoundaryTag(blocks.find(block => block.from <= child.from && child.from < block.to));
			if (precedingTo !== null) {
				const previousLine = state.doc.lineAt(precedingTo).number;
				const nextLine = state.doc.lineAt(from).number;
				if (nextLine === previousLine + 1) {
					const row = state.doc.line(nextLine).from;
					beforeRows.add(row);
					boundaries.set(row, { before: precedingTag, after: tag });
				}
			}
			precedingTo = content.toSource(child.to);
			precedingTag = tag;
		}
	}
	const result = { beforeRows, boundaries };
	cache.set(state, result);
	return result;
}
