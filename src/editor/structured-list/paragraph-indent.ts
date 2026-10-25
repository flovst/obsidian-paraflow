import { ChangeSet, type ChangeSpec } from '@codemirror/state';
import type { EditPlan, EditPlanFragment, EditRegionId } from './edit-plan.js';
import type { ListContext } from './model.js';
import { composeEditPlan, remapIndentation, rewriteWhitespaceBoundary } from './primitives.js';
import { markdownColumns } from './prefix.js';

/** Move an additional paragraph into the preceding list's last direct child. */
export function indentOwnedParagraph(context: ListContext): EditPlan {
	const { caretContent, source, topology, editScope } = context;
	const parent = caretContent.paragraphIndentParent!;
	const indexes = caretContent.subtreeBlockIndexes;
	const first = indexes[0]!;
	const last = indexes.at(-1)!;
	const target = markdownColumns(source.text.slice(parent.lineFrom, parent.prefix.outerMarker.to));
	const initial = markdownColumns(topology.ownedBlocks[first]!.indentText);
	const ids: EditRegionId[] = indexes.map(index => ({ kind: 'owned-block', index }));
	const movement = remapIndentation(source, editScope, ids, target - initial);
	const anchors: ChangeSpec[] = indexes.flatMap(index => {
		const block = topology.ownedBlocks[index]!;
		const from = block.range.from + block.indentText.length;
		return block.relativeDepth === 0 && source.text[from] === '\u200b' ? [{ from, to: from + 1, insert: '' }] : [];
	});
	const fragments: EditPlanFragment[] = [{ ...movement, changes: [...movement.changes, ...anchors] }];
	for (const [index, boundary] of topology.whitespaceBoundaries.entries()) {
		const original = source.slice(boundary.range);
		let replacement = original;
		if (boundary.toAnchor === `owned-block:${first}` && topology.ownedBlocks[first - 1]!.relativeDepth > 1) {
			// End the grandchild list before appending to its direct parent.
			replacement = original.replace(/\n[ \t]*(?=\n)/gu, '\n' + ' '.repeat(target));
		}
		if (boundary.fromAnchor === `owned-block:${last}` && boundary.newlineCount < 2) {
			replacement = '\n' + ' '.repeat(initial) + '\n';
		}
		if (replacement !== original) fragments.push(rewriteWhitespaceBoundary(editScope, boundary,
			{ kind: 'whitespace-boundary', index }, replacement));
	}
	const plan = composeEditPlan('tab', editScope, fragments);
	const changes: ChangeSpec[] = [];
	ChangeSet.of(plan.changes, source.length).iterChanges((from, to, _fromB, _toB, inserted) =>
		changes.push({ from, to, insert: inserted }));
	return { ...plan, changes };
}
