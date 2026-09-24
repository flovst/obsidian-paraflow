import type { EditPlan, EditPlanFragment, EditRegionId } from '../edit-plan.js';
import type { ExceptionId } from '../exception-registry.js';
import type {
	ListContext,
	OwnedBlock,
	SiblingPosition,
	WhitespaceBoundaryFact,
} from '../model.js';
import type {
	ExecutionFor,
	OperationResult,
	StructuralOperationId,
} from '../operations.js';
import {
	composeEditPlan,
	renumberOrderedItems,
	replaceCurrentPrefix,
	replaceEmptyItem,
	replaceOwnedBlockIndentation,
	rewriteWhitespaceBoundary,
	splitItem,
} from '../primitives.js';

type EnterOperation =
	| 'enter-non-empty'
	| 'enter-task-non-empty'
	| 'enter-empty-nested'
	| 'enter-empty-top-level'
	| 'shift-enter';
type NonEmptyOperation = 'enter-non-empty' | 'enter-task-non-empty';
type TaskState = ' ' | 'x';

const currentContentId = { index: null, kind: 'current-content' } as const;
const currentItemId = { index: null, kind: 'current-item' } as const;
const currentPrefixId = { index: null, kind: 'current-prefix' } as const;

interface EmptyLayout {
	readonly caretLine: number;
	readonly lines: number;
}

const nestedEmptyLayouts: Readonly<Record<SiblingPosition, EmptyLayout>> = {
	final: { caretLine: 1, lines: 2 },
	first: { caretLine: 1, lines: 3 },
	middle: { caretLine: 1, lines: 3 },
	only: { caretLine: 1, lines: 2 },
};

const topLevelEmptyLayouts: Readonly<Record<Exclude<SiblingPosition, 'only'>, EmptyLayout>> = {
	final: { caretLine: 0, lines: 1 },
	first: { caretLine: 0, lines: 2 },
	middle: { caretLine: 1, lines: 3 },
};

const continuationBoundaryRules = [
	{
		matches: (boundary: WhitespaceBoundaryFact): boolean =>
			boundary.fromAnchor === 'owned-block:0' &&
			boundary.toAnchor === 'owned-block:1' &&
			boundary.newlineCount === 2 &&
			boundary.lines.length === 1 &&
			boundary.lines[0]?.kind === 'empty',
		replacement: (owned: OwnedBlock): string => `\n${owned.indentText}\n`,
	},
] as const;

function editResult(plan: EditPlan): OperationResult {
	return { kind: 'edit', plan };
}

function physicalIndent(context: ListContext): string {
	return context.source.slice({
		from: context.current.lineFrom,
		to: context.current.prefix.outerMarker.from,
	});
}

function originalTaskState(context: ListContext): TaskState {
	const token = context.current.prefix.taskToken;
	if (!token) throw new Error('Normalized task prefix has no task token');
	return context.source.slice(token)[1]?.toLowerCase() === 'x' ? 'x' : ' ';
}

function nextOrderedValue(context: ListContext): number | undefined {
	if (context.current.prefix.orderedValue === null) return undefined;
	const current = context.topology.orderedSequence?.renderedValue ??
		context.current.prefix.orderedValue;
	return current === null ? undefined : current + 1;
}

function sameLevelPrefix(
	execution: ExecutionFor<EnterOperation>,
	taskState?: TaskState,
	orderedValue = nextOrderedValue(execution.context),
): string {
	const options: { orderedValue?: number; taskState?: TaskState } = {};
	if (orderedValue !== undefined) options.orderedValue = orderedValue;
	if (taskState !== undefined) options.taskState = taskState;
	return physicalIndent(execution.context) +
		execution.services.prefixPolicy.renderSameLevel(execution.context.current.prefix, options);
}

function orderedIdsAfterCurrent(context: ListContext): readonly EditRegionId[] {
	const currentIndex = context.topology.orderedSequence?.currentIndex;
	if (currentIndex === undefined) return [];
	return context.editScope.regionIds.filter((id) =>
		id.kind === 'ordered-sequence-item' && id.index !== null && id.index > currentIndex);
}

function insertionRenumberFragments(
	execution: ExecutionFor<EnterOperation>,
): readonly EditPlanFragment[] {
	const sequence = execution.context.topology.orderedSequence;
	const ids = orderedIdsAfterCurrent(execution.context);
	return sequence && ids.length > 0
		? [renumberOrderedItems(
			execution.context.source,
			execution.context.editScope,
			ids,
			sequence,
			1,
		)]
		: [];
}

function removalRenumberFragments(
	execution: ExecutionFor<'enter-empty-nested' | 'enter-empty-top-level'>,
): readonly EditPlanFragment[] {
	const sequence = execution.context.topology.orderedSequence;
	const firstValue = sequence?.items[0]?.prefix.orderedValue;
	const ids = orderedIdsAfterCurrent(execution.context);
	if (!sequence || firstValue === null || firstValue === undefined || ids.length === 0) return [];
	return [renumberOrderedItems(
		execution.context.source,
		execution.context.editScope,
		ids,
		sequence,
		firstValue - sequence.renderedValue - 1,
	)];
}

function continuationWhitespaceFragments(
	execution: ExecutionFor<NonEmptyOperation>,
	owned: OwnedBlock,
): readonly EditPlanFragment[] {
	const context = execution.context;
	for (const rule of continuationBoundaryRules) {
		const index = context.topology.whitespaceBoundaries.findIndex(rule.matches);
		if (index < 0) continue;
		const boundary = context.topology.whitespaceBoundaries[index];
		if (!boundary) return [];
		return [rewriteWhitespaceBoundary(
			context.editScope,
			boundary,
			{ index, kind: 'whitespace-boundary' },
			rule.replacement(owned),
		)];
	}
	return [];
}

function continuationPlan(
	execution: ExecutionFor<NonEmptyOperation>,
	taskState?: TaskState,
): EditPlan {
	const owned = execution.context.topology.ownedBlocks[0];
	if (!owned || owned.kind !== 'continuation') {
		throw new Error('Continuation decision requires the first normalized continuation block');
	}
	const fragments = [
		replaceOwnedBlockIndentation(
			execution.context,
			{ index: 0, kind: 'owned-block' },
			owned,
			sameLevelPrefix(execution, taskState),
		),
		...continuationWhitespaceFragments(execution, owned),
		...insertionRenumberFragments(execution),
	];
	return composeEditPlan(
		execution.intent.operation,
		execution.context.editScope,
		fragments,
	);
}

function splitPlan(
	execution: ExecutionFor<NonEmptyOperation>,
	taskState?: TaskState,
): EditPlan {
	const context = execution.context;
	const fragments: EditPlanFragment[] = [];
	if (context.current.prefix.kind === 'task' && context.caretZone === 'start') {
		const unchecked = execution.services.prefixPolicy.renderSameLevel(
			context.current.prefix,
			{ taskState: ' ' },
		);
		if (context.source.slice(context.current.prefix.full) !== unchecked) {
			fragments.push(replaceCurrentPrefix(
				context,
				currentPrefixId,
				unchecked,
			));
		}
	}
	fragments.push(splitItem(
		context,
		currentContentId,
		context.caret,
		sameLevelPrefix(execution, taskState),
	));
	fragments.push(...insertionRenumberFragments(execution));
	return composeEditPlan(
		execution.intent.operation,
		context.editScope,
		fragments,
	);
}

function taskStateForNonEmpty(
	context: ListContext,
	continuation: boolean,
): TaskState | undefined {
	if (context.current.prefix.kind !== 'task') return undefined;
	if (continuation || context.caretZone !== 'end') return originalTaskState(context);
	return ' ';
}

const nonEmptyPlanRules = [
	{
		matches: (context: ListContext): boolean =>
			context.caretZone === 'end' &&
			context.topology.ownedBlocks[0]?.kind === 'continuation',
		plan: continuationPlan,
	},
	{
		matches: (_context: ListContext): boolean => true,
		plan: splitPlan,
	},
] as const;

function nonEmptyPlan(execution: ExecutionFor<NonEmptyOperation>): EditPlan | null {
	const { context } = execution;
	if (context.caretZone === 'empty') return null;
	const decision = nonEmptyPlanRules.find((rule) => rule.matches(context));
	if (!decision) return null;
	const continuation = decision.plan === continuationPlan;
	return decision.plan(execution, taskStateForNonEmpty(context, continuation));
}

function desiredEmptyIndent(context: ListContext): string {
	const descendant = context.topology.ownedBlocks.find((owned) => owned.kind === 'descendant');
	return descendant?.indentText ?? physicalIndent(context);
}

function emptyReplacement(
	context: ListContext,
	layout: EmptyLayout,
): { readonly caretOffset: number; readonly text: string } {
	const indent = desiredEmptyIndent(context);
	const preserved = context.source.slice({
		from: context.current.lineFrom,
		to: context.current.markerLine.from,
	});
	const first = indent.startsWith(preserved) ? indent.slice(preserved.length) : indent;
	const lines = [first, ...Array.from({ length: layout.lines - 1 }, () => indent)];
	return {
		caretOffset: lines.slice(0, layout.caretLine + 1).join('\n').length,
		text: lines.join('\n'),
	};
}

function convertEmptyPlan(
	execution: ExecutionFor<'enter-empty-nested' | 'enter-empty-top-level'>,
	layout: EmptyLayout,
	exceptionId: ExceptionId | null,
): EditPlan {
	const replacement = emptyReplacement(execution.context, layout);
	const fragments = [
		replaceEmptyItem(
			execution.context,
			currentItemId,
			replacement.text,
			replacement.caretOffset,
		),
		...removalRenumberFragments(execution),
	];
	return composeEditPlan(
		execution.intent.operation,
		execution.context.editScope,
		fragments,
		exceptionId === null
			? null
			: exceptionId,
	);
}

function duplicateEmptyPlan(execution: ExecutionFor<'enter-empty-top-level'>): EditPlan {
	const context = execution.context;
	const originalState = context.current.prefix.kind === 'task'
		? originalTaskState(context)
		: undefined;
	const original = execution.services.prefixPolicy.renderSameLevel(
		context.current.prefix,
		originalState === undefined ? {} : { taskState: originalState },
	);
	const unchecked = context.current.prefix.kind === 'task'
		? execution.services.prefixPolicy.renderSameLevel(context.current.prefix, { taskState: ' ' })
		: original;
	const first = originalState === 'x' ? unchecked : original;
	const second = originalState === 'x' ? original : unchecked;
	const replacement = `${first}\n${second}`;
	const fragment = replaceEmptyItem(
		context,
		currentItemId,
		replacement,
		replacement.length,
	);
	return composeEditPlan(
		execution.intent.operation,
		context.editScope,
		[fragment],
		'SLX-004',
	);
}

function validOperation<K extends StructuralOperationId>(
	execution: ExecutionFor<K>,
	operation: K,
): boolean {
	return execution.intent.operation === operation && execution.context.editScope.operation === operation;
}

export function enterNonEmpty(execution: ExecutionFor<'enter-non-empty'>): OperationResult {
	if (!validOperation(execution, 'enter-non-empty')) return { kind: 'pass-through' };
	if (execution.context.current.prefix.kind === 'task') return { kind: 'pass-through' };
	const plan = nonEmptyPlan(execution);
	return plan ? editResult(plan) : { kind: 'pass-through' };
}

export function enterTaskNonEmpty(
	execution: ExecutionFor<'enter-task-non-empty'>,
): OperationResult {
	if (!validOperation(execution, 'enter-task-non-empty')) return { kind: 'pass-through' };
	if (execution.context.current.prefix.kind !== 'task') return { kind: 'pass-through' };
	const plan = nonEmptyPlan(execution);
	return plan ? editResult(plan) : { kind: 'pass-through' };
}

export function enterEmptyNested(
	execution: ExecutionFor<'enter-empty-nested'>,
): OperationResult {
	if (!validOperation(execution, 'enter-empty-nested')) return { kind: 'pass-through' };
	const { context } = execution;
	if (context.caretZone !== 'empty' || context.topology.depth === 0) {
		return { kind: 'pass-through' };
	}
	return editResult(convertEmptyPlan(
		execution,
		nestedEmptyLayouts[context.topology.siblingPosition],
		'SLX-003',
	));
}

export function enterEmptyTopLevel(
	execution: ExecutionFor<'enter-empty-top-level'>,
): OperationResult {
	if (!validOperation(execution, 'enter-empty-top-level')) return { kind: 'pass-through' };
	const { context } = execution;
	if (context.caretZone !== 'empty' || context.topology.depth !== 0) {
		return { kind: 'pass-through' };
	}
	if (context.topology.siblingPosition === 'only') {
		return editResult(duplicateEmptyPlan(execution));
	}
	return editResult(convertEmptyPlan(
		execution,
		topLevelEmptyLayouts[context.topology.siblingPosition],
		null,
	));
}

export function shiftEnter(execution: ExecutionFor<'shift-enter'>): OperationResult {
	if (!validOperation(execution, 'shift-enter')) return { kind: 'pass-through' };
	const { context } = execution;
	if (context.caretZone === 'empty') return { kind: 'pass-through' };
	const continuationIndent = context.current.prefix.kind === 'task'
		? physicalIndent(context) + ' '.repeat(
			context.current.prefix.outerMarker.to - context.current.prefix.outerMarker.from,
		)
		: physicalIndent(context) +
			execution.services.prefixPolicy.contentIndent(context.current.prefix);
	const fragment = splitItem(
		context,
		currentContentId,
		context.caret,
		continuationIndent,
	);
	return editResult(composeEditPlan(
		execution.intent.operation,
		context.editScope,
		[fragment],
	));
}
