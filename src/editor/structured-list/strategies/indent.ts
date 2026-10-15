import type { EditPlan, EditPlanFragment, EditRegionId } from '../edit-plan.js';
import type { ExceptionId } from '../exception-registry.js';
import type { ListContext } from '../model.js';
import type { ExecutionFor, OperationResult } from '../operations.js';
import { literalBodyTab } from '../../literal-tab.js';
import { markdownColumns } from '../prefix.js';
import {
	composeEditPlan,
	convertItemToParagraph,
	insertContentText,
	remapIndentation,
	renumberOrderedItems,
	replaceListBlockPrefix,
	rewriteWhitespaceBoundary,
} from '../primitives.js';

type IndentOperation = 'tab' | 'shift-tab';

const currentItemId = { index: null, kind: 'current-item' } as const;
const currentContentId = { index: null, kind: 'current-content' } as const;

function editResult(plan: EditPlan): OperationResult {
	return { kind: 'edit', plan };
}

function validOperation<K extends IndentOperation>(execution: ExecutionFor<K>, operation: K): boolean {
	return execution.intent.operation === operation && execution.context.editScope.operation === operation;
}

function ownedIds(context: ListContext): readonly EditRegionId[] {
	return context.topology.ownedBlocks.map((_owned, index) => ({
		index,
		kind: 'owned-block' as const,
	}));
}

function tabMovementIds(context: ListContext): readonly EditRegionId[] {
	const first = context.topology.ownedBlocks[0];
	return first?.kind === 'continuation'
		? [currentItemId, { index: 0, kind: 'owned-block' }]
		: [currentItemId];
}

function tabDelta(execution: ExecutionFor<'tab'>): number {
	const previous = execution.context.topology.previousSibling;
	if (!previous) return 0;
	const currentIndent = physicalIndent(execution.context);
	const contentColumn = markdownColumns(execution.context.source.slice({
		from: previous.lineFrom, to: previous.prefix.outerMarker.to,
	}));
	return contentColumn - currentIndent;
}

function blockPhysicalIndent(context: ListContext, block: ListContext['current']): number {
	const markerFrom = block.prefix.outerMarker.to - block.prefix.separatorText.length - block.prefix.markerText.length;
	return markdownColumns(context.source.slice({ from: block.lineFrom, to: markerFrom }));
}

function physicalIndent(context: ListContext): number {
	return blockPhysicalIndent(context, context.current);
}

function markerContainerWidth(context: ListContext): number {
	return markdownColumns(context.source.slice({
		from: context.current.lineFrom, to: context.current.prefix.outerMarker.to,
	})) - physicalIndent(context);
}

function fallbackText(context: ListContext): string {
	if (context.caretContent.kind !== 'marker-line') {
		const before = context.source.text.slice(context.caretContent.range.from, context.caret);
		return literalBodyTab(before);
	}
	return context.caretZone === 'middle' ? '\t' : '\u200b\t';
}

function fallbackPlan(execution: ExecutionFor<'tab'>): EditPlan {
	const fragment = insertContentText(
		execution.context,
		currentContentId,
		fallbackText(execution.context),
	);
	return composeEditPlan(
		execution.intent.operation,
		execution.context.editScope,
		[fragment],
		'SLX-001',
	);
}

function tabStructuralPlan(
	execution: ExecutionFor<'tab'>,
	delta: number,
	exceptionId: ExceptionId | null,
): EditPlan {
	const movement = tabMovementIds(execution.context).map((id) => remapIndentation(
		execution.context.source,
		execution.context.editScope,
		[id],
		delta,
	));

	return composeEditPlan(
		execution.intent.operation,
		execution.context.editScope,
		movement,
		exceptionId,
	);
}

function orderedIdsAfter(
	context: ListContext,
	sequence: NonNullable<ListContext['topology']['orderedSequence']>,
	kind: 'ordered-sequence-item' | 'parent-ordered-sequence-item' = 'ordered-sequence-item',
): readonly EditRegionId[] {
	return context.editScope.regionIds.filter((id) =>
		id.kind === kind && id.index !== null &&
		id.index > sequence.currentIndex);
}

function renderedPrefix(
	execution: ExecutionFor<IndentOperation>,
	block: ListContext['current'],
	indent: number,
	orderedValue: number,
): string {
	const taskToken = block.prefix.taskToken
		? execution.context.source.slice(block.prefix.taskToken)
		: '';
	return ' '.repeat(indent) + execution.services.prefixPolicy.renderSameLevel(
		{ ...block.prefix, kind: block.prefix.orderedValue === null ? 'unordered' : 'ordered' },
		{ orderedValue },
	) + taskToken;
}

function orderedContinuationFragments(
	execution: ExecutionFor<'tab'>,
	delta: number,
): readonly EditPlanFragment[] {
	if (execution.context.topology.ownedBlocks[0]?.kind !== 'continuation') return [];
	return [remapIndentation(
		execution.context.source,
		execution.context.editScope,
		[{ index: 0, kind: 'owned-block' }],
		delta,
	)];
}

function orderedChildFragments(
	execution: ExecutionFor<'tab'>,
	child: ListContext['current'] | null,
	indent: number,
	orderedValue: number,
): readonly EditPlanFragment[] {
	if (!child) return [];
	return [replaceListBlockPrefix(
		execution.context.source,
		execution.context.editScope,
		{ index: 0, kind: 'owned-block' },
		child,
		renderedPrefix(execution, child, indent, orderedValue),
	)];
}

function orderedTabPlan(execution: ExecutionFor<'tab'>, delta: number): EditPlan {
	const { context } = execution;
	const sequence = context.topology.orderedSequence;
	const firstOwned = context.topology.ownedBlocks[0];
	const child = firstOwned?.kind === 'descendant' &&
		context.topology.followingBoundary.kind === 'list-item'
		? context.topology.followingBoundary.block
		: null;
	if (!sequence) return tabStructuralPlan(execution, delta, 'SLX-002');
	const indent = physicalIndent(context) + delta;
	const firstValue = context.topology.orderedIndentStart;
	const fragments: EditPlanFragment[] = [
		replaceListBlockPrefix(
			context.source,
			context.editScope,
			currentItemId,
			context.current,
			renderedPrefix(execution, context.current, indent, firstValue),
		),
		...orderedContinuationFragments(execution, delta),
		...orderedChildFragments(execution, child, indent, firstValue + 1),
	];
	const followingIds = orderedIdsAfter(context, sequence);
	if (followingIds.length > 0) fragments.push(renumberOrderedItems(
		context.source,
		context.editScope,
		followingIds,
		sequence,
		-1,
	));
	return { ...composeEditPlan('tab', context.editScope, fragments, 'SLX-002'), ownsOrderedNumbering: true };
}

function rewriteBoundary(
	execution: ExecutionFor<'shift-tab'>,
	index: number,
	replacement: string,
): EditPlanFragment {
	const boundary = execution.context.topology.whitespaceBoundaries[index];
	if (!boundary) throw new Error(`Normalized whitespace boundary ${index} is absent`);
	return rewriteWhitespaceBoundary(
		execution.context.editScope,
		boundary,
		{ index, kind: 'whitespace-boundary' },
		replacement,
	);
}

function nestedShiftTabPlan(execution: ExecutionFor<'shift-tab'>): EditPlan {
	const { context } = execution;
	const parent = context.topology.parent;
	if (!parent) throw new Error('Nested Shift Tab requires a normalized parent');
	const delta = blockPhysicalIndent(context, parent) - physicalIndent(context);
	const fragments = [currentItemId, ...ownedIds(context)].map(id => remapIndentation(
		context.source, context.editScope, [id], delta,
	));
	return composeEditPlan('shift-tab', context.editScope, fragments,
		context.topology.ownedBlocks.length > 0 ? 'SLX-002' : null);
}
function nestedOrderedShiftTabPlan(execution: ExecutionFor<'shift-tab'>): EditPlan | null {
	const { context } = execution;
	const sequence = context.topology.parentOrderedSequence;
	const parent = context.topology.parent;
	if (!sequence || !parent) return null;
	const targetValue = sequence.renderedValue + 1;
	const target = replaceListBlockPrefix(
		context.source,
		context.editScope,
		currentItemId,
		context.current,
		renderedPrefix(execution, context.current, blockPhysicalIndent(context, parent), targetValue),
	);
	const owned = ownedIds(context).map((id) => remapIndentation(
		context.source,
		context.editScope,
		[id],
		blockPhysicalIndent(context, parent) - physicalIndent(context),
	));
	const followingIds = orderedIdsAfter(context, sequence, 'parent-ordered-sequence-item');
	const renumber = followingIds.length === 0 ? [] : [renumberOrderedItems(
		context.source,
		context.editScope,
		followingIds,
		sequence,
		1,
	)];
	const originalSequence = context.topology.orderedSequence;
	const originalFollowingIds = originalSequence ? orderedIdsAfter(context, originalSequence) : [];
	if (originalSequence) {
		if (originalFollowingIds.length > 0) renumber.unshift(renumberOrderedItems(
			context.source, context.editScope, originalFollowingIds, originalSequence, -originalSequence.renderedValue,
		));
	}
	const boundaries = orderedOwnedBoundaryFragments(execution, originalFollowingIds.length > 0);
	return { ...composeEditPlan('shift-tab', context.editScope, [
		...boundaries.before, target, ...owned, ...boundaries.after, ...renumber,
	],
		'SLX-002'), ownsOrderedNumbering: true };
}

function orderedOwnedBoundaryFragments(execution: ExecutionFor<'shift-tab'>, following: boolean): {
	readonly before: readonly EditPlanFragment[];
	readonly after: readonly EditPlanFragment[];
} {
	const { context } = execution;
	const first = context.topology.followingBoundary;
	if (context.topology.ownedBlocks[0]?.kind !== 'descendant' || first.kind !== 'list-item' ||
		first.block.prefix.orderedValue === null) return { before: [], after: [] };
	const indexes = topLevelBoundaryIndexes(context);
	const separated = (index: number): readonly EditPlanFragment[] => {
		const count = context.topology.whitespaceBoundaries[index]!.newlineCount;
		return count >= 2 ? [] : [addedBoundaryNewline(execution, index, 2 - count)];
	};
	return { before: indexes.before === null ? [] : separated(indexes.before),
		after: following ? separated(indexes.after) : [] };
}

function addedBoundaryNewline(
	execution: ExecutionFor<'shift-tab'>,
	index: number,
	count = 1,
): EditPlanFragment {
	const boundary = execution.context.topology.whitespaceBoundaries[index];
	if (!boundary) throw new Error(`Normalized whitespace boundary ${index} is absent`);
	return rewriteBoundary(
		execution,
		index,
		execution.context.source.slice(boundary.range) + '\n'.repeat(count),
	);
}

function topLevelBoundaryIndexes(context: ListContext): {
	readonly after: number;
	readonly before: number | null;
} {
	const boundaries = context.topology.whitespaceBoundaries;
	const before = boundaries.findIndex((boundary) =>
		boundary.toAnchor === 'current-marker-line');
	const after = boundaries.findIndex((boundary) =>
		boundary.fromAnchor === (context.topology.ownedBlocks.length === 0
			? 'current-marker-line'
			: `owned-block:${context.topology.ownedBlocks.length - 1}`));
	if (after < 0) throw new Error('Normalized following whitespace boundary is absent');
	return { after, before: before < 0 ? null : before };
}

function topLevelMovementFragments(
	execution: ExecutionFor<'shift-tab'>,
): readonly EditPlanFragment[] {
	const { context } = execution;
	const ids = ownedIds(context);
	const conversion = convertItemToParagraph(
		context,
		[currentItemId],
	);
	if (ids.length === 0) return [conversion];
	const step = markerContainerWidth(context);
	return [conversion, remapIndentation(
			context.source,
			context.editScope,
			ids,
			-step,
		)];
}

function topLevelAfterCount(context: ListContext): number {
	if (context.current.content.from === context.current.content.to) return 1;
	if (context.current.prefix.kind === 'ordered') return 2;
	return context.topology.ownedBlocks.length > 0 ? 1 : 0;
}

function topLevelBoundaryFragments(
	execution: ExecutionFor<'shift-tab'>,
	indexes: ReturnType<typeof topLevelBoundaryIndexes>,
): { readonly after: readonly EditPlanFragment[]; readonly before: readonly EditPlanFragment[] } {
	const count = topLevelAfterCount(execution.context);
	return {
		after: count === 0 ? [] : [addedBoundaryNewline(execution, indexes.after, count)],
		before: indexes.before === null ? [] : [addedBoundaryNewline(execution, indexes.before)],
	};
}

function topLevelRenumberFragments(
	execution: ExecutionFor<'shift-tab'>,
): readonly EditPlanFragment[] {
	const sequence = execution.context.topology.orderedSequence;
	if (!sequence) return [];
	const ids = orderedIdsAfter(execution.context, sequence);
	if (ids.length === 0) return [];
	return [renumberOrderedItems(
		execution.context.source,
		execution.context.editScope,
		ids,
		sequence,
		-2,
	)];
}

function topLevelShiftTabPlan(execution: ExecutionFor<'shift-tab'>): EditPlan {
	const indexes = topLevelBoundaryIndexes(execution.context);
	const boundaries = topLevelBoundaryFragments(execution, indexes);
	const fragments = [
		...boundaries.before,
		...topLevelMovementFragments(execution),
		...boundaries.after,
		...topLevelRenumberFragments(execution),
	];
	return composeEditPlan(
		execution.intent.operation,
		execution.context.editScope,
		fragments,
	);
}

export function tab(execution: ExecutionFor<'tab'>): OperationResult {
	if (!validOperation(execution, 'tab')) return { kind: 'pass-through' };
	if (execution.context.caretContent.kind !== 'marker-line') return editResult(fallbackPlan(execution));
	const delta = tabDelta(execution);
	if (delta === 0) return editResult(fallbackPlan(execution));
	const exceptionId = execution.context.topology.ownedBlocks.length > 0
		? 'SLX-002'
		: null;
	return editResult(execution.context.current.prefix.orderedValue !== null
		? orderedTabPlan(execution, delta)
		: tabStructuralPlan(execution, delta, exceptionId));
}

export function shiftTab(execution: ExecutionFor<'shift-tab'>): OperationResult {
	if (!validOperation(execution, 'shift-tab')) return { kind: 'pass-through' };
	const { context } = execution;
	if (context.caretContent.kind !== 'marker-line') {
		const indexes = context.caretContent.subtreeBlockIndexes;
		if (context.topology.ownedBlocks[indexes[0]!]!.indentText.length === 0) return { kind: 'pass-through' };
		const ids = indexes.map(index => ({ index, kind: 'owned-block' as const }));
		const step = markerContainerWidth(context);
		return editResult(composeEditPlan('shift-tab', context.editScope, [
			remapIndentation(context.source, context.editScope, ids, -step),
		]));
	}
	const ordered = execution.context.current.prefix.orderedValue !== null &&
		execution.context.topology.depth > 0
		? nestedOrderedShiftTabPlan(execution)
		: null;
	return editResult(ordered ?? (execution.context.topology.depth > 0
		? nestedShiftTabPlan(execution)
		: topLevelShiftTabPlan(execution)));
}
