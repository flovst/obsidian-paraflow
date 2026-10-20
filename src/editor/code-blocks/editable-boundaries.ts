import { countColumn, EditorSelection, Facet, type EditorState, type SelectionRange, type Transaction } from '@codemirror/state';
import type { CodeBlock } from './model.js';
import { containerBlockFrame } from '../callout/container-surface.js';
import { projectQuoteContent } from '../callout/projection.js';
import { getParagraphProjectionState } from '../paragraph/projection.js';
import { discoverCodeBlocks } from './model.js';
import {documentContentStart,isVirtualEdgeActive} from '../runtime/virtual-tail.js';
import {calloutGaps} from '../callout/gaps.js';

export const codeMarkersActive = Facet.define<boolean,boolean>({combine:values=>values.some(Boolean)});
import {codeDraftStart} from './draft-state.js';
export {codeDraftStart} from './draft-state.js';

/** Match the same container prefix used when the virtual code body materializes. */
export function codeContinuationPrefix(state: EditorState, block: CodeBlock): string {
	const text = state.doc.lineAt(block.closed ? block.barAt : block.from).text;
	return text.slice(0, text.search(/`{3,}|~{3,}/u)).replace(/(?:[-+*]|\d+[.)])[ \t]+$/u,
		marker => ' '.repeat(countColumn(marker, 4)));
}

/** Metadata navigation enters content after structural container prefixes. */
export function codeBodyStart(state: EditorState, block: CodeBlock): number {
	if (!block.lines.length) return state.doc.lineAt(block.from).to;
	const first = block.lines[0]!;
	if(first.contentFrom !== undefined)return first.contentFrom;
	const frame = containerBlockFrame(state, first.from, first.to);
	return frame ? projectQuoteContent(state, first.from, first.to, frame.rails.cards.at(-1)!.depth)!.toSource(0) : first.from;
}

/** Fences include their adjacent newline positions, but actual body blank rows remain editable. */
export function editableEndpoint(state: EditorState, blocks: readonly CodeBlock[], position: number, direction: number, range: SelectionRange): number {
	if(isVirtualEdgeActive(state)&&position===range.head)return position;
	if(!range.empty&&position===0&&documentContentStart(state)>0)return position;
	for (const block of blocks) {
		if (block.indented || state.facet(codeDraftStart) === block.from) continue;
		// A range spanning the entire construct must retain its complete Markdown source.
		if (!range.empty && range.from <= block.from && range.to >= block.to) continue;
		const first = codeBodyStart(state, block), last = block.lines.at(-1)?.to ?? first;
		if (position >= block.from && position < first) {
			if (direction < 0 && block.from > 0) return editableEndpoint(state, blocks, block.from - 1, direction, range);
			return first;
		}
		if (position > last && position <= block.to) {
			if (direction > 0 && block.to < state.doc.length) return editableEndpoint(state, blocks, state.doc.lineAt(block.to).to + 1, direction, range);
			return last;
		}
	}
	const index=getParagraphProjectionState(state)?.rangeIndex;
	const normalized = direction && index ? index.normalize(position,direction<0?-1:1) : position;
	const gap = direction ? calloutGaps(state).find(gap => gap.from < normalized && normalized < gap.to) : undefined;
	return gap ? direction < 0 ? gap.from : gap.to : normalized;
}

export function codeEditableSelection(transaction: Transaction, blocks: readonly CodeBlock[], activating = false): EditorSelection | null {
	if ((!transaction.selection && !activating) || transaction.docChanged&&!transaction.isUserEvent('delete.backward')) return null;
	if(transaction.docChanged)blocks=discoverCodeBlocks(transaction.state);
	const keyboard = (transaction.isUserEvent('select') && !transaction.isUserEvent('select.pointer')) || transaction.isUserEvent('move.character') || transaction.isUserEvent('move.line');
	const previous = transaction.startState.selection.ranges;
	let changed = false;
	const ranges = transaction.newSelection.ranges.map((range, index) => {
		const direction = keyboard ? Math.sign(range.head - (previous[index] ?? transaction.startState.selection.main).head) : 0;
		const head = editableEndpoint(transaction.state, blocks, range.head, direction, range);
		const anchor = range.empty ? head : editableEndpoint(transaction.state, blocks, range.anchor, 0, range);
		if (anchor === range.anchor && head === range.head) return range;
		changed = true;
		return anchor === head
			? EditorSelection.cursor(head, range.assoc, range.bidiLevel ?? undefined, range.goalColumn)
			: EditorSelection.range(anchor, head, range.goalColumn, range.bidiLevel ?? undefined);
	});
	return changed ? EditorSelection.create(ranges, transaction.newSelection.mainIndex) : null;
}
