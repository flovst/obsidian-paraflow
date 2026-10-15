import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView } from '@codemirror/view';

export interface CommentOptions {
	readonly isActive: (view: EditorView) => boolean;
	readonly getMode: () => 'always' | 'editing';
}

interface CommentRange { from: number; to: number }

function discoverComments(state: EditorState): readonly CommentRange[] {
	const comments: CommentRange[] = [];
	let current: CommentRange | null = null;
	syntaxTree(state).iterate({ enter(node) {
		const tokens = node.name.split('_');
		if (!tokens.includes('comment')) return;
		if (tokens.includes('comment-start')) {
			current = { from: node.from, to: node.to };
			comments.push(current);
		} else if (current) {
			current.to = node.to;
		}
		if (tokens.includes('comment-end')) current = null;
	} });
	return comments;
}

const commentRanges = StateField.define<readonly CommentRange[]>({
	create: discoverComments,
	update: (value, transaction) => transaction.docChanged || syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
		? discoverComments(transaction.state) : value,
});

export function createCommentExtension(options: CommentOptions): Extension {
	function project(view: EditorView, composing: boolean): DecorationSet {
		if (!options.isActive(view) || composing || view.composing) return Decoration.none;
		const ranges: Range<Decoration>[] = [];
		for (const comment of view.state.field(commentRanges)) {
			const visible = options.getMode() === 'always' || view.state.selection.ranges.some(
				selection => selection.from <= comment.to && selection.to >= comment.from);
			ranges.push(Decoration.mark({ class: visible ? 'paraflow-comment-visible' : 'paraflow-comment-hidden',
				attributes: visible ? {} : { 'aria-hidden': 'true' } }).range(comment.from, comment.to));
		}
		return Decoration.set(ranges, true);
	}
	const projection = ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		composing = false;
		destroyed = false;
		constructor(readonly view: EditorView) {
			const active = options.isActive(view);
			this.decorations = project(view, false);
			queueMicrotask(() => { if (!this.destroyed && active !== options.isActive(view)) view.dispatch({}); });
		}
		update(): void { this.decorations = project(this.view, this.composing); }
		destroy(): void { this.destroyed = true; }
	}, { decorations: value => value.decorations, eventHandlers: {
		compositionstart() { this.composing = true; this.view.dispatch({}); },
		compositionend() { this.composing = false; this.view.dispatch({}); },
	} });
	// Non-atomic marks retain native cursor/selection, copying, and Undo semantics.
	return [commentRanges, projection];
}

export const COMMENT_CSS = `
.paraflow-comment-visible, .paraflow-comment-visible * { color: var(--paraflow-source-color, var(--text-faint)) !important; }
.paraflow-comment-hidden, .paraflow-comment-hidden * { font-size: 0 !important; }
`;
