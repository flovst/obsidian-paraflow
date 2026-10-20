import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { isVirtualTailActive } from '../runtime/virtual-tail.js';
import { createBlockBodySelection } from '../runtime/block-selection.js';
import { codeBodyStart, codeContinuationPrefix } from './editable-boundaries.js';
import { codeDraftStart } from './draft-state.js';
import { discoverCodeBlocks } from './model.js';
import { blockLineContentFrom } from '../runtime/block-body.js';

export function createCodeBodySelection(isActive: (view: EditorView) => boolean): Extension {
	return createBlockBodySelection(view => {
		if (!isActive(view) || view.composing || isVirtualTailActive(view.state)) return null;
		const state = view.state, selection = state.selection.main;
		for (const block of discoverCodeBlocks(state)) {
			if (block.from === state.facet(codeDraftStart)) continue;
			const from = codeBodyStart(state, block), to = block.lines.at(-1)?.to ?? from;
			if (from <= selection.from && selection.to <= to) {
				const prefix = block.lines.length ? state.sliceDoc(state.doc.lineAt(from).from, from) : codeContinuationPrefix(state, block);
				return { from, to, prefix, lines: block.lines.map(line => ({
					from: line.contentFrom ?? blockLineContentFrom(state, state.doc.lineAt(line.from).number, prefix), to: line.to,
				})) };
			}
		}
		return null;
	});
}
