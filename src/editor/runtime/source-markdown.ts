import { TreeFragment, type Tree } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';

interface Snapshot { readonly source: string; readonly tree: Tree }

/** Complete source grammars stay independent of the host's partial syntax tree. */
function sourceParser(grammar: typeof parser): (source: string) => Tree {
	let previous: Snapshot | undefined;
	return source => {
		if (previous?.source === source) return previous.tree;
		let fragments: readonly TreeFragment[] = [];
		if (previous) {
			const before = previous.source;
			let from = 0, oldTo = before.length, newTo = source.length;
			while (from < oldTo && from < newTo && before.charCodeAt(from) === source.charCodeAt(from)) from++;
			while (oldTo > from && newTo > from && before.charCodeAt(oldTo - 1) === source.charCodeAt(newTo - 1)) { oldTo--; newTo--; }
			fragments = TreeFragment.applyChanges(TreeFragment.addTree(previous.tree), [{ fromA: from, toA: oldTo, fromB: from, toB: newTo }]);
		}
		const tree = grammar.parse(source, fragments);
		previous = { source, tree };
		return tree;
	};
}

// One bounded snapshot per grammar also shares identical source across consumers.
export const sourceMarkdownTree = sourceParser(parser);
export const sourceGfmTree = sourceParser(parser.configure(GFM));
