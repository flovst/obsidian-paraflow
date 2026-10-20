import { pendingMathAt } from '../math/candidate-ranges.js';
import type { EditorState } from '@codemirror/state';
import type { Tree } from '@lezer/common';
import { mathSyntaxTree } from '../math/semantic-tree.js';

export function hasNativeOwnership(tree: Tree, from: number, to: number): boolean {
	let owned = false;
	tree.iterate({ from, to, enter(node) {
		if (/CalloutNative|FencedCode|CodeBlock|HTMLBlock|Table/u.test(node.name) ||
			/(?:^|[ _-])(?:math|frontmatter|yaml|comment)(?:$|[ _-])/iu.test(node.name)) owned = true;
	} });
	return owned;
}

export function hostOwnsSelection(state: EditorState): boolean {
	return !pendingMathAt(state, state.selection.main.from, state.selection.main.to) && hasNativeOwnership(mathSyntaxTree(state), state.selection.main.from, state.selection.main.to);
}
