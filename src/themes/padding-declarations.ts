import * as css from 'css-tree';

/** Remove padding fallbacks only when a later declaration has an unconditional, basic length value. */
export function normalizePaddingDeclarations(block: css.Block): css.Declaration[] {
	const winners = new Map<string, css.Declaration>();
	const removed: css.Declaration[] = [];
	block.children.forEachRight((node, item) => {
		if (node.type !== 'Declaration') return;
		const property = node.property.toLowerCase();
		if (!/^padding(?:-(?:top|right|bottom|left))?$/u.test(property)) return;
		const winner = winners.get(property);
		if (winner && (!node.important || winner.important)) {
			block.children.remove(item);
			removed.push(node);
			return;
		}
		if (node.value.type !== 'Value') return;
		const parts = node.value.children.toArray();
		if (parts.length < 1 || parts.length > (property === 'padding' ? 4 : 1)) return;
		if (parts.every(part => part.type === 'Number' ? Number(part.value) === 0
			: part.type === 'Percentage' ? Number(part.value) >= 0
				: part.type === 'Dimension' && /^(?:px|em|rem)$/iu.test(part.unit) && Number(part.value) >= 0)) {
			winners.set(property, node);
		}
	});
	return removed.reverse();
}
