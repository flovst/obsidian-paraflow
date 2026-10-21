import type { EditorState } from '@codemirror/state';
import { quotePrefix } from '../callout/prefix.js';
import { discoverMath } from './syntax.js';

/** A terminal quote-edge Tab inside display math is editable TeX, even on a bare-marker row. */
export function mathQuotePrefix(state: EditorState, from: number, depth: number): string | null {
	const prefix = quotePrefix(state.doc.lineAt(from).text, depth);
	if (!prefix?.endsWith('\t')) return prefix;
	const body = from + prefix.length;
	const owner = discoverMath(state).find(expression => expression.display && expression.contentFrom <= body && body < expression.contentTo);
	if (!owner) return prefix;
	const opening = state.doc.lineAt(owner.from), ownerDepth = (state.sliceDoc(opening.from, owner.from).match(/>/gu) ?? []).length;
	return depth === ownerDepth ? prefix.slice(0, -1) : prefix;
}
