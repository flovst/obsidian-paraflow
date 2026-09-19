import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import type { EditorState, Extension, SelectionRange } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { selectionPresentationSession } from '../runtime/selection-session.js';

export type InlineSelectionSourceKind = 'delimiter' | 'link-destination';

export interface InlineSelectionSourceRange {
	readonly from: number;
	readonly kind: InlineSelectionSourceKind;
	readonly to: number;
}

function nameTokens(name: string): readonly string[] {
	return name.toLowerCase().split(/[\s_]+/u);
}

function hasAncestor(node: SyntaxNode, predicate: (name: string) => boolean): boolean {
	for (let current = node.parent; current; current = current.parent) {
		if (predicate(current.name)) return true;
	}
	return false;
}

function ancestorNamed(node: SyntaxNode, name: string): SyntaxNode | null {
	for (let current = node.parent; current; current = current.parent) {
		if (current.name === name) return current;
	}
	return null;
}

function standardInlineLink(node: SyntaxNode): SyntaxNode | null {
	const link = ancestorNamed(node, 'Link');
	return link?.getChild('URL') ? link : null;
}

function delimiterRange(
	node: SyntaxNode,
	kind: InlineSelectionSourceKind = 'delimiter',
): InlineSelectionSourceRange {
	return { from: node.from, kind, to: node.to };
}

function edgeRanges(
	node: SyntaxNode,
	width: number,
): readonly InlineSelectionSourceRange[] {
	return [
		{ from: node.from, kind: 'delimiter', to: node.from + width },
		{ from: node.to - width, kind: 'delimiter', to: node.to },
	];
}

function hypermdContainerRanges(
	state: EditorState,
	node: SyntaxNode,
): readonly InlineSelectionSourceRange[] {
	const tokens = nameTokens(node.name);
	const source = state.sliceDoc(node.from, node.to);
	if (tokens.includes('inline-code')) {
		const opening = /^`+/u.exec(source)?.[0] ?? '';
		if (opening.length > 0 && source.endsWith(opening) && source.length > opening.length * 2) {
			return edgeRanges(node, opening.length);
		}
	}
	if (tokens.some((token) => token.includes('highlight')) &&
		source.startsWith('==') && source.endsWith('==') && source.length > 4) {
		return edgeRanges(node, 2);
	}
	if (tokens.some((token) => token.includes('strong'))) {
		const opening = /^(?:\*\*|__)/u.exec(source)?.[0] ?? '';
		if (opening.length > 0 && source.endsWith(opening) && source.length > 4) {
			return edgeRanges(node, opening.length);
		}
	}
	if (tokens.some((token) => token.includes('emphasis') || token === 'em')) {
		const opening = /^(?:\*|_)/u.exec(source)?.[0] ?? '';
		if (opening.length > 0 && source.endsWith(opening) && source.length > 2) {
			return edgeRanges(node, opening.length);
		}
	}
	if (tokens.some((token) => token.includes('link')) &&
		source.startsWith('[') && source.endsWith(')')) {
		const split = source.indexOf('](');
		if (split > 0 && split + 2 < source.length) {
			return [
				{ from: node.from, kind: 'delimiter', to: node.from + 1 },
				{ from: node.from + split, kind: 'delimiter', to: node.from + split + 2 },
				{
					from: node.from + split + 2,
					kind: 'link-destination',
					to: node.to - 1,
				},
				{ from: node.to - 1, kind: 'delimiter', to: node.to },
			];
		}
	}
	return [];
}

function rangesForNode(
	state: EditorState,
	node: SyntaxNode,
): readonly InlineSelectionSourceRange[] {
	if (node.name === 'EmphasisMark' &&
		hasAncestor(node, (name) => name === 'Emphasis' || name === 'StrongEmphasis')) {
		return [delimiterRange(node)];
	}
	if (node.name === 'CodeMark' && hasAncestor(node, (name) => name === 'InlineCode')) {
		return [delimiterRange(node)];
	}
	if (node.name === 'HighlightMark' && hasAncestor(node, (name) => name === 'Highlight')) {
		return [delimiterRange(node)];
	}
	if (node.name === 'LinkMark' && standardInlineLink(node)) {
		return [delimiterRange(node)];
	}
	if (node.name === 'URL' && standardInlineLink(node)) {
		return [delimiterRange(node, 'link-destination')];
	}

	const tokens = nameTokens(node.name);
	const source = state.sliceDoc(node.from, node.to);
	const formatting = tokens.some((token) => token.startsWith('formatting-'));
	if (formatting) {
		if (/^(?:\*{1,2}|_{1,2}|==|`+)$/u.test(source) &&
			tokens.some((token) => /(?:em|strong|highlight|code)/u.test(token))) {
			return [delimiterRange(node)];
		}
		if (['[', ']', '(', ')'].includes(source) &&
			tokens.some((token) => token.includes('link'))) {
			return [delimiterRange(node)];
		}
	}
	if (node.name !== 'URL' && tokens.some((token) => token.includes('url')) &&
		hasAncestor(node, (name) => nameTokens(name).some((token) => token.includes('link')))) {
		return [delimiterRange(node, 'link-destination')];
	}
	return /[-_]/u.test(node.name) ? hypermdContainerRanges(state, node) : [];
}

export function discoverInlineSelectionSourceRanges(
	state: EditorState,
): readonly InlineSelectionSourceRange[] {
	if (!syntaxTreeAvailable(state, state.doc.length)) return [];
	const ranges = new Map<string, InlineSelectionSourceRange>();
	syntaxTree(state).iterate({
		enter: (ref) => {
			for (const range of rangesForNode(state, ref.node)) {
				if (range.from >= range.to) continue;
				ranges.set(`${range.from}:${range.to}`, range);
			}
		},
	});
	const ordered = [...ranges.values()].sort((left, right) =>
		left.from - right.from || left.to - right.to);
	const nonOverlapping: InlineSelectionSourceRange[] = [];
	for (const range of ordered) {
		const previous = nonOverlapping.at(-1);
		if (!previous || previous.to <= range.from) {
			nonOverlapping.push(range);
			continue;
		}
		nonOverlapping[nonOverlapping.length - 1] = {
			from: previous.from,
			kind: previous.kind === range.kind ? previous.kind : 'delimiter',
			to: Math.max(previous.to, range.to),
		};
	}
	return nonOverlapping;
}

function intersectsSelection(
	range: InlineSelectionSourceRange,
	selection: SelectionRange,
): boolean {
	return selection.from < range.to && range.from < selection.to;
}

function decorationsFor(view: EditorView, active: boolean, owned: boolean): DecorationSet {
	if (!active || !owned) return Decoration.none;
	const selections = view.state.selection.ranges.filter((range) => !range.empty);
	const ranges = discoverInlineSelectionSourceRanges(view.state)
		.filter((range) => selections.some((selection) => intersectsSelection(range, selection)))
		.map((range) => Decoration.replace({}).range(range.from, range.to));
	return Decoration.set(ranges, true);
}

export function createInlineSelectionProjection(
	isActive: (view: EditorView) => boolean,
): Extension {
	return ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		private active: boolean;
		private owned: boolean;
		private tree: Tree;

		constructor(readonly view: EditorView) {
			this.active = isActive(view);
			this.owned = this.active ? selectionPresentationSession(view.state).owned : false;
			this.tree = syntaxTree(view.state);
			this.decorations = decorationsFor(view, this.active, this.owned);
		}

		update(update: ViewUpdate): void {
			const active = isActive(this.view);
			const owned = active ? selectionPresentationSession(update.state).owned : false;
			const tree = syntaxTree(update.state);
			if (!update.docChanged && !update.selectionSet && !update.viewportChanged &&
				active === this.active && owned === this.owned && tree === this.tree) return;
			this.active = active;
			this.owned = owned;
			this.tree = tree;
			this.decorations = decorationsFor(this.view, active, owned);
		}
	}, {
		decorations: (value) => value.decorations,
	});
}
