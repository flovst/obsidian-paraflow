import { countColumn, EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { SyntaxNode } from '@lezer/common';
import { contentSyntaxTree, quotePrefix } from '../callout/projection.js';
import { selectionModeAnnotation } from './input-state.js';

export interface BlockBodyLine { readonly from: number; readonly to: number }

/** Paragraph endpoints are discovered inside their containers, including list continuations. */
export function adjacentBlock<Block extends BlockBodyLine>(state: EditorState, blocks: readonly Block[], forward: boolean):
	{ block: Block; current: BlockBodyLine; next: BlockBodyLine | undefined } | null {
	const head = state.selection.main.head, paragraphs: BlockBodyLine[] = [];
	const tree = contentSyntaxTree(state);
	const owner = (position: number): string => {
		const ancestors: string[] = [];
		for (let node: SyntaxNode | null = tree.resolveInner(position, 1); node; node = node.parent) {
			if (node.name === 'Blockquote' || node.name === 'ListItem') ancestors.push(node.name + ':' + node.from);
		}
		return ancestors.join('/');
	};
	tree.iterate({ enter(node) {
		if (node.name !== 'Paragraph') return;
		const parent = node.node.parent;
		if (parent?.name === 'Blockquote' && state.doc.lineAt(parent.from).number === state.doc.lineAt(node.from).number && /^\[![^\]]+\]/u.test(state.sliceDoc(node.from, node.to))) {
			const title = state.doc.lineAt(node.from);
			if (node.to > title.to) paragraphs.push({ from: blockLineContentFrom(state, title.number + 1, blockContinuationPrefix(state, node.from)), to: node.to });
			return;
		}
		paragraphs.push({ from: node.from, to: node.to });
	} });
	const current = paragraphs.find(paragraph => forward ? paragraph.to === head : paragraph.from === head);
	if (!current) return null;
	const prefix = blockContinuationPrefix(state, current.from);
	const container = owner(current.from);
	const depth = (prefix.match(/>/gu) ?? []).length;
	const gap = (from: number, to: number): boolean => from < to && state.sliceDoc(from, to).split('\n').every((line, index) =>
		(index === 0 ? line : line.slice(depth ? quotePrefix(line, depth)?.length ?? 0 : 0)).trim() === '');
	const block = blocks.filter(block => owner(block.from) === container &&
		(forward ? head < block.from && gap(head, block.from) : block.to < head && gap(block.to, head)))
		.sort((a, b) => forward ? a.from - b.from : b.to - a.to)[0];
	return block ? { block, current, next: paragraphs.find(paragraph => owner(paragraph.from) === container && block.to < paragraph.from && gap(block.to, paragraph.from)) } : null;
}

/** The fence's proven container owns this prefix; further indentation is body text. */
export function blockContinuationPrefix(state: EditorState, fenceFrom: number): string {
	const line = state.doc.lineAt(fenceFrom), prefix = state.sliceDoc(line.from, fenceFrom);
	let list = false, depth = 0;
	for (let node: SyntaxNode | null = contentSyntaxTree(state).resolveInner(fenceFrom, 1); node; node = node.parent) {
		if (node.name === 'ListItem') list = true;
		if (node.name === 'Blockquote') depth++;
	}
	if (list) return prefix.replace(/(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?$/u, marker => ' '.repeat(countColumn(marker, 4)));
	return depth ? quotePrefix(line.text, depth)! : '';
}

export function blockLineContentFrom(state: EditorState, number: number, prefix: string): number {
	const line = state.doc.line(number);
	if (line.text.startsWith(prefix)) return line.from + prefix.length;
	const depth = (prefix.match(/>/gu) ?? []).length;
	return line.from + (depth ? quotePrefix(line.text, depth)?.length ?? 0 : 0);
}

/** Only structural line edits are owned here; native typing and Shift+Enter stay native. */
export function planBlockBodyKey(state: EditorState, key: 'Enter' | 'Backspace' | 'Delete',
	lines: readonly BlockBodyLine[], prefix: string): TransactionSpec | null {
	if (!prefix) return null;
	const head = state.selection.main.head, index = lines.findIndex(line => line.from <= head && head <= line.to);
	if (index < 0) return null;
	const line = lines[index]!;
	let from = head, to = head, insert = '';
	if (key === 'Enter') {
		if (line.from !== line.to) return null;
		insert = '\n' + prefix;
	} else if (key === 'Backspace' && head === line.from && index > 0) from = lines[index - 1]!.to;
	else if (key === 'Delete' && head === line.to && index + 1 < lines.length) to = lines[index + 1]!.from;
	else return null;
	return { changes: { from, to, insert }, selection: EditorSelection.single(from + insert.length),
		userEvent: key === 'Enter' ? 'input.block-line' : key === 'Backspace' ? 'delete.backward' : 'delete.forward',
		annotations: [isolateHistory.of('full'), selectionModeAnnotation.of('normal')], scrollIntoView: true };
}
