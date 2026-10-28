import type { EditorState } from '@codemirror/state';
import { discoverCodeBlocks } from './code-blocks/model.js';
import { codeBlocksIn } from './code-blocks/source-scan.js';
import { codeContinuationPrefix } from './code-blocks/editable-boundaries.js';
import { blockLineContentFrom } from './runtime/block-body.js';

export interface CodeMenuBody { readonly from: number; readonly to: number; readonly text: string; }

/** Menu actions share the editable body's range and strip only structural container prefixes. */
export function codeBodyAtMenuPosition(state: EditorState, position: number): CodeMenuBody | null {
	const blocks = discoverCodeBlocks(state);
	const block = blocks.find(candidate => candidate.from <= position && position <= candidate.to) ??
		codeBlocksIn(state.doc, true).find(candidate => candidate.from <= position && position <= candidate.to &&
			/(?:`{3,}|~{3,})[ \t]*mermaid(?:\s|$)/iu.test(state.doc.lineAt(candidate.from).text));
	if (!block) return null;
	const prefix = block.indented ? '' : codeContinuationPrefix(state, block);
	const lines = block.lines.map(line => ({ from: line.contentFrom ?? blockLineContentFrom(state, state.doc.lineAt(line.from).number, prefix), to: line.to }));
	const from = lines[0]?.from ?? state.doc.lineAt(block.from).to;
	return { from, to: lines.at(-1)?.to ?? from, text: lines.map(line => state.sliceDoc(line.from, line.to)).join('\n') };
}
