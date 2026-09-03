import type { EditPlan, EditPlanFragment, EditRegionId } from '../edit-plan.js';
import { exceptionStrategies, type ExceptionId } from '../exception-registry.js';
import type { ListContext } from '../model.js';
import type { ExecutionFor, OperationResult } from '../operations.js';
import {
	composeEditPlan,
	convertItemToParagraph,
	insertAfterListBlock,
	insertContentText,
	remapIndentation,
	renumberOrderedItems,
	replaceListBlockPrefix,
	rewriteWhitespaceBoundary,
} from '../primitives.js';

type IndentOperation = 'tab' | 'shift-tab';

const currentItemId = { index: null, kind: 'current-item' } as const;
const currentContentId = { index: null, kind: 'current-content' } as const;

function registeredException(id: ExceptionId, operation: IndentOperation): ExceptionId {
	const entry = exceptionStrategies.get(id);
	if (!entry?.operations.some((candidate) => candidate === operation)) {
		throw new Error(`Exception ${id} is not registered for ${operation}`);
	}
	return entry.id;
}

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
	const previousIndent = previous.prefix.full.from - previous.lineFrom;
	const currentIndent = physicalIndent(execution.context);
	const structuralWidth = previous.prefix.outerMarker.to - previous.prefix.outerMarker.from;
	return previousIndent + structuralWidth - currentIndent;
}

function physicalIndent(context: ListContext): number {
	return context.current.prefix.full.from - context.current.lineFrom;
}

function fallbackText(context: ListContext): string {
	return context.caretZone === 'middle' ? '\t' : '\u200b\t';
}

function fallbackPlan(execution: ExecutionFor<'tab'>): EditPlan {
	const fragment = insertContentText(
		execution.context,
		currentContentId,
		fallbackText(execution.context),
		execution.services.capabilities,
	);
	return composeEditPlan(
		execution.intent.operation,
		execution.context.editScope,
		[fragment],
		execution.services.capabilities,
		registeredException('SLX-001', execution.intent.operation),
	);
}

function tabWhitespaceFragments(execution: ExecutionFor<'tab'>): readonly EditPlanFragment[] {
	const { context } = execution;
	if (
		context.topology.ownedBlocks[0]?.kind !== 'continuation' ||
		context.topology.ownedBlocks[1]?.kind !== 'additional-paragraph'
	) return [];
	return context.topology.whitespaceBoundaries.flatMap((boundary, index) => {
		const beforeTarget = boundary.fromAnchor === 'previous-block' &&
			boundary.toAnchor === 'current-marker-line';
		const beforeParagraph = boundary.fromAnchor === 'owned-block:0' &&
			boundary.toAnchor === 'owned-block:1';
		if (!beforeTarget && !beforeParagraph) return [];
		return [rewriteWhitespaceBoundary(
			context.editScope,
			boundary,
			{ index, kind: 'whitespace-boundary' },
			context.source.slice(boundary.range) + '\n',
			execution.services.capabilities,
		)];
	});
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
		execution.services.capabilities,
	));
	const whitespace = tabWhitespaceFragments(execution);
	const fragments = whitespace.length === 0
		? movement
		: [whitespace[0] as EditPlanFragment, ...movement, ...whitespace.slice(1)];
	return composeEditPlan(
		execution.intent.operation,
		execution.context.editScope,
		fragments,
		execution.services.capabilities,
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
	return ' '.repeat(indent) + execution.services.prefixPolicy.renderSameLevel(
		block.prefix,
		{ orderedValue },
	);
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
		execution.services.capabilities,
	)];
}

function orderedChildFragments(
	execution: ExecutionFor<'tab'>,
	child: ListContext['current'] | null,
	indent: number,
): readonly EditPlanFragment[] {
	if (!child) return [];
	return [replaceListBlockPrefix(
		execution.context.source,
		execution.context.editScope,
		{ index: 0, kind: 'owned-block' },
		child,
		renderedPrefix(execution, child, indent, 2),
		execution.services.capabilities,
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
	const fragments: EditPlanFragment[] = [
		replaceListBlockPrefix(
			context.source,
			context.editScope,
			currentItemId,
			context.current,
			renderedPrefix(execution, context.current, indent, 1),
			execution.services.capabilities,
		),
		...orderedContinuationFragments(execution, delta),
		...orderedChildFragments(execution, child, indent),
	];
	const followingIds = orderedIdsAfter(context, sequence);
	if (followingIds.length > 0) fragments.push(renumberOrderedItems(
		context.source,
		context.editScope,
		followingIds,
		sequence,
		execution.services.capabilities,
		-1,
	));
	return composeEditPlan('tab', context.editScope, fragments, execution.services.capabilities, 'SLX-002');
}

function boundaryIndex(
	context: ListContext,
	predicate: (from: string, to: string) => boolean,
): number {
	return context.topology.whitespaceBoundaries.findIndex((boundary) =>
		predicate(boundary.fromAnchor, boundary.toAnchor));
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
		execution.services.capabilities,
	);
}

interface NestedShiftPolicy {
	readonly after: number;
	readonly before: number;
	readonly deep: boolean;
	readonly delta: number;
	readonly parentIndent: number;
	readonly profile: boolean;
}

function nestedShiftPolicy(context: ListContext): NestedShiftPolicy {
	const parent = context.topology.parent;
	const parentIndent = parent ? parent.prefix.full.from - parent.lineFrom : 0;
	const owned = context.topology.ownedBlocks;
	return {
		after: boundaryIndex(context, (from, to) =>
			from === `owned-block:${owned.length - 1}` && to === 'following-block'),
		before: boundaryIndex(context, (_from, to) => to === 'current-marker-line'),
		deep: context.topology.depth > 1,
		delta: parentIndent - physicalIndent(context),
		parentIndent,
		profile: owned[0]?.kind === 'continuation' &&
			owned.some((block) => block.kind === 'additional-paragraph'),
	};
}

function nestedBeforeFragments(
	execution: ExecutionFor<'shift-tab'>,
	policy: NestedShiftPolicy,
): readonly EditPlanFragment[] {
	if (!policy.deep || policy.before < 0) return [];
	const boundary = execution.context.topology.whitespaceBoundaries[policy.before]!;
	return [rewriteBoundary(execution, policy.before,
		execution.context.source.slice(boundary.range) +
		' '.repeat(policy.parentIndent) + '\n')];
}

function nestedTargetFragment(
	execution: ExecutionFor<'shift-tab'>,
	policy: NestedShiftPolicy,
): EditPlanFragment {
	const { context } = execution;
	return policy.profile ? replaceListBlockPrefix(
		context.source,
		context.editScope,
		currentItemId,
		context.current,
		'\n' + context.source.slice(context.current.prefix.full),
		execution.services.capabilities,
	) : remapIndentation(
		context.source,
		context.editScope,
		[currentItemId],
		policy.delta,
		execution.services.capabilities,
	);
}

function nestedOwnedFragments(
	execution: ExecutionFor<'shift-tab'>,
	delta: number,
): readonly EditPlanFragment[] {
	return ownedIds(execution.context).map((id) => remapIndentation(
		execution.context.source,
		execution.context.editScope,
		[id],
		delta,
		execution.services.capabilities,
	));
}

function nestedAfterBoundaryIndex(context: ListContext, policy: NestedShiftPolicy): number {
	const trailing = context.topology.shiftTabTrailingBlankPolicy;
	return trailing.kind === 'around-next-sibling'
		? trailing.beforeBoundaryIndex
		: policy.after;
}

function shouldRewriteNestedAfter(context: ListContext, policy: NestedShiftPolicy): boolean {
	return policy.deep || policy.profile ||
		context.topology.shiftTabTrailingBlankPolicy.kind === 'around-next-sibling';
}

function nestedAfterFragments(
	execution: ExecutionFor<'shift-tab'>,
	policy: NestedShiftPolicy,
): readonly EditPlanFragment[] {
	const index = nestedAfterBoundaryIndex(execution.context, policy);
	if (index < 0 || !shouldRewriteNestedAfter(execution.context, policy)) return [];
	const boundary = execution.context.topology.whitespaceBoundaries[index]!;
	const suffix = policy.deep ? ' '.repeat(policy.parentIndent) + '\n' : '\n';
	return [rewriteBoundary(execution, index,
		execution.context.source.slice(boundary.range) + suffix)];
}

function nestedTrailingFragments(
	execution: ExecutionFor<'shift-tab'>,
): readonly EditPlanFragment[] {
	const { context } = execution;
	const trailing = context.topology.shiftTabTrailingBlankPolicy;
	if (trailing.kind !== 'around-next-sibling') return [];
	return [insertAfterListBlock(
		context.editScope,
		{ index: 0, kind: 'following-block' },
		trailing.nextSibling,
		'\n',
		execution.services.capabilities,
	)];
}

function nestedShiftTabPlan(execution: ExecutionFor<'shift-tab'>): EditPlan {
	const policy = nestedShiftPolicy(execution.context);
	const fragments = [
		...nestedBeforeFragments(execution, policy),
		nestedTargetFragment(execution, policy),
		...nestedOwnedFragments(execution, policy.delta),
		...nestedAfterFragments(execution, policy),
		...nestedTrailingFragments(execution),
	];
	const exceptionId = execution.context.topology.ownedBlocks.length > 0 ? 'SLX-002' : null;
	return composeEditPlan('shift-tab', execution.context.editScope, fragments,
		execution.services.capabilities, exceptionId);
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
		renderedPrefix(execution, context.current, parent.prefix.full.from - parent.lineFrom, targetValue),
		execution.services.capabilities,
	);
	const owned = ownedIds(context).map((id) => remapIndentation(
		context.source,
		context.editScope,
		[id],
		(parent.prefix.full.from - parent.lineFrom) - physicalIndent(context),
		execution.services.capabilities,
	));
	const followingIds = orderedIdsAfter(context, sequence, 'parent-ordered-sequence-item');
	const renumber = followingIds.length === 0 ? [] : [renumberOrderedItems(
		context.source,
		context.editScope,
		followingIds,
		sequence,
		execution.services.capabilities,
		1,
	)];
	return composeEditPlan('shift-tab', context.editScope, [target, ...owned, ...renumber],
		execution.services.capabilities, registeredException('SLX-002', 'shift-tab'));
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
		execution.services.capabilities,
	);
	if (ids.length === 0) return [conversion];
	const step = context.current.prefix.outerMarker.to - context.current.prefix.outerMarker.from;
	return [conversion, remapIndentation(
			context.source,
			context.editScope,
			ids,
			-step,
			execution.services.capabilities,
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
		execution.services.capabilities,
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
		execution.services.capabilities,
	);
}

export function tab(execution: ExecutionFor<'tab'>): OperationResult {
	if (!validOperation(execution, 'tab')) return { kind: 'pass-through' };
	const delta = tabDelta(execution);
	if (delta === 0) return editResult(fallbackPlan(execution));
	const exceptionId = execution.context.topology.ownedBlocks.length > 0
		? registeredException('SLX-002', execution.intent.operation)
		: null;
	return editResult(execution.context.current.prefix.kind === 'ordered'
		? orderedTabPlan(execution, delta)
		: tabStructuralPlan(execution, delta, exceptionId));
}

export function shiftTab(execution: ExecutionFor<'shift-tab'>): OperationResult {
	if (!validOperation(execution, 'shift-tab')) return { kind: 'pass-through' };
	const ordered = execution.context.current.prefix.kind === 'ordered' &&
		execution.context.topology.depth > 0
		? nestedOrderedShiftTabPlan(execution)
		: null;
	return editResult(ordered ?? (execution.context.topology.depth > 0
		? nestedShiftTabPlan(execution)
		: topLevelShiftTabPlan(execution)));
}
