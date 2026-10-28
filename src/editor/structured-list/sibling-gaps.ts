import type { EditorState, Text } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { sourceListTree } from './syntax.js';
import { hasListGroupBoundary, listGroupBoundary } from './group-boundary.js';

const cache = new WeakMap<Text, ReadonlySet<number>>();

function projectedGroupBoundary(state: EditorState, gaps: readonly number[], item: SyntaxNode): boolean {
	if (gaps.length < 2) return false;
	let depth = 0;
	for (let parent = item.parent; parent; parent = parent.parent) if (parent.name === 'Blockquote') depth++;
	// Quote markers are container structure, not indentation in the projected list.
	const projected = '\n' + gaps.map(at => {
		let text = state.doc.lineAt(at).text;
		for (let index = 0; index < depth; index++) text = text.replace(/^[ \t]*>[ \t]?/u, '');
		return text;
	}).join('\n') + '\n';
	return hasListGroupBoundary(projected, 0, projected.length);
}

function trailingGapRows(state: EditorState, from: number, to: number): readonly number[] {
	const gaps: number[] = [];
	for (let number = state.doc.lineAt(to).number - 1; number > state.doc.lineAt(from).number; number--) {
		const line = state.doc.line(number);
		if (!/^(?:\s*>)*\s*$/u.test(line.text)) break;
		gaps.unshift(line.from);
	}
	return gaps;
}

/** Adjacent marker rows in one list tree share its rhythm across nesting levels. */
export function listSiblingGapRows(state: EditorState): ReadonlySet<number> {
	const cached = cache.get(state.doc);
	if (cached) return cached;
	const rows = new Set<number>();
	const items: SyntaxNode[] = [];
	sourceListTree(state).iterate({ enter(node) {
		if (node.name === 'ListItem') items.push(node.node);
	} });
	const listRoot = (item: SyntaxNode): number => {
		let root = item.parent!;
		for (let parent = root.parent; parent; parent = parent.parent) {
			if (parent.name === 'BulletList' || parent.name === 'OrderedList') root = parent;
		}
		return root.from;
	};
	for (let index = 1; index < items.length; index++) {
		const previous = items[index - 1]!, next = items[index]!;
		if (listRoot(previous) !== listRoot(next)) continue;
		const gaps = trailingGapRows(state, previous.from, next.from);
		if (!gaps.length || state.doc.lineAt(gaps[0]!).number !== state.doc.lineAt(previous.from).number + 1) continue;
		if (listGroupBoundary(state.doc, previous.from, next.from) !== null || projectedGroupBoundary(state, gaps, previous)) continue;
		gaps.forEach(at => rows.add(at));
	}
	cache.set(state.doc, rows);
	return rows;
}

export const listSiblingGapProjection = EditorView.decorations.compute(['doc'], state =>
	Decoration.set([...listSiblingGapRows(state)].map(at =>
		Decoration.line({ attributes: { 'data-paraflow-list-sibling-gap': '' } }).range(at)), true));
