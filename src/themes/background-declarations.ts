import * as css from 'css-tree';

/** A supported var() wins the cascade even when its substituted value is invalid. */
export function normalizeBackgroundDeclarations(block: css.Block): css.Declaration[] {
	const winners = new Map<string, css.Declaration>();
	const removed: css.Declaration[] = [];
	block.children.forEachRight((node, item) => {
		if (node.type !== 'Declaration') return;
		const property = node.property.toLowerCase();
		if (property !== 'background' && property !== 'background-color') return;
		const winner = winners.get(property);
		if (winner && (!node.important || winner.important)) {
			block.children.remove(item);
			removed.push(node);
			return;
		}
		// Limit normalization to the unambiguous, whole-value variable syntax.
		if (/^var\(--[a-z_][\w-]*\)$/iu.test(css.generate(node.value))) winners.set(property, node);
	});
	return removed.reverse();
}
