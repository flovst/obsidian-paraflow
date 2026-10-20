import type { ListBlockRef, ListTopology, SourceSnapshot } from './model.js';

/** A cross-family move joins the parent and separates the remaining original list. */
export function indentBoundaryChanges(source: SourceSnapshot, first: ListBlockRef,
	topology: ListTopology, last: ListBlockRef = first): readonly { from: number; to: number; insert: string }[] {
	const parent = topology.indentParent;
	if (!parent || topology.previousSibling) return [];
	const before = source.text.slice(parent.item.to, first.lineFrom);
	const joined = before.replace(/\n[ \t]*\n/u, '\n');
	const changes = joined === before ? []
		: [{ from: parent.item.to, to: first.lineFrom, insert: joined }];
	const following = source.text.slice(last.item.to).match(/^\n(?:[ \t]*\n)*[ \t]*\S/u);
	if (following) {
		changes.push({ from: last.item.to, to: last.item.to, insert: first.prefix.taskToken ? '\n' : '\n\n' });
	}
	return changes;
}
