import type { EditPlan, EditPlanFragment, EditRegionId, EditScope } from '../edit-plan.js';
import { exceptionStrategies, type ExceptionId } from '../exception-registry.js';
import type {
	ListBlockRef,
	ListContext,
	NormalizedStructuralBoundary,
	OwnedBlock,
	BoundaryAnchor,
} from '../model.js';
import type { ExecutionFor, OperationResult } from '../operations.js';
import {
	composeEditPlan,
	convertItemToParagraph,
	remapIndentation,
	replaceEmptyItem,
	replaceListBlockPrefix,
	rewriteWhitespaceBoundary,
} from '../primitives.js';

type BackspaceOperation =
	| 'backspace-nested-content-start'
	| 'backspace-top-level-content-start'
	| 'backspace-empty-nested'
	| 'backspace-empty-top-level';

interface EmptyReplacement {
	readonly caretOffset: number;
	readonly text: string;
}

type BoundaryRole = 'preceding' | 'first-owned' | 'following';

interface BoundaryRequirement {
	readonly fromAnchor: BoundaryAnchor;
	readonly role: BoundaryRole;
	readonly toAnchor: BoundaryAnchor;
}

interface BoundaryPrerequisites {
	readonly preceding: NormalizedStructuralBoundary | null;
	readonly 'first-owned': NormalizedStructuralBoundary | null;
	readonly following: NormalizedStructuralBoundary | null;
}

interface BackspacePrerequisites {
	readonly boundaries: BoundaryPrerequisites;
	readonly ownedRegionIds: readonly EditRegionId[];
}

interface PrerequisitePolicy {
	readonly boundaryRegionRoles: readonly BoundaryRole[];
	readonly includeOwnedRegions: boolean;
	readonly includeRelationshipRegions: boolean;
}

const currentItemId = { index: null, kind: 'current-item' } as const;

function validOperation<K extends BackspaceOperation>(
	execution: ExecutionFor<K>,
	operation: K,
): boolean {
	return execution.intent.operation === operation &&
		execution.intent.direction === 'backward' &&
		execution.context.editScope.operation === operation;
}

function editResult(plan: EditPlan): OperationResult {
	return { kind: 'edit', plan };
}

function registeredException(id: ExceptionId, operation: BackspaceOperation): ExceptionId {
	const entry = exceptionStrategies.get(id);
	if (!entry?.operations.some((candidate) => candidate === operation)) {
		throw new Error(`Exception ${id} is not registered for ${operation}`);
	}
	return entry.id;
}

function emptyExceptionId(nested: boolean, operation: BackspaceOperation): ExceptionId | null {
	return nested ? registeredException('SLX-003', operation) : null;
}

function physicalIndent(context: ListContext): string {
	return context.source.slice({
		from: context.current.lineFrom,
		to: context.current.prefix.outerMarker.from,
	});
}

function paragraphIndent(block: ListBlockRef | null): string {
	if (!block) return '';
	return ' '.repeat(block.prefix.outerMarker.to - block.lineFrom);
}

function desiredIndent(context: ListContext, reclassified: boolean): string {
	return reclassified ? '' : paragraphIndent(context.topology.precedingContainer);
}

function requiredBoundarySpecs(context: ListContext): readonly BoundaryRequirement[] {
	const requirements: BoundaryRequirement[] = [];
	if (context.topology.previousSibling) {
		requirements.push({
			fromAnchor: 'previous-block',
			role: 'preceding',
			toAnchor: 'current-marker-line',
		});
	}
	if (context.topology.ownedBlocks.length > 0) {
		requirements.push({
			fromAnchor: 'current-marker-line',
			role: 'first-owned',
			toAnchor: 'owned-block:0',
		});
	}
	if (!context.topology.atDocumentEnd) {
		const lastOwned = context.topology.ownedBlocks.length - 1;
		requirements.push({
			fromAnchor: lastOwned < 0 ? 'current-marker-line' : `owned-block:${lastOwned}`,
			role: 'following',
			toAnchor: 'following-block',
		});
	}
	return requirements;
}

function resolveBoundaries(context: ListContext): BoundaryPrerequisites | null {
	const resolved: Record<BoundaryRole, NormalizedStructuralBoundary | null> = {
		'first-owned': null,
		following: null,
		preceding: null,
	};
	for (const requirement of requiredBoundarySpecs(context)) {
		const matches = context.topology.structuralBoundaries.filter((boundary) =>
			boundary.whitespace.fromAnchor === requirement.fromAnchor &&
			boundary.whitespace.toAnchor === requirement.toAnchor);
		if (matches.length !== 1) return null;
		resolved[requirement.role] = matches[0]!;
	}
	return resolved;
}

function relationshipRegionIds(context: ListContext): readonly EditRegionId[] {
	const ids: EditRegionId[] = [currentItemId];
	if (context.topology.precedingContainer) ids.push({ index: 0, kind: 'preceding-container' });
	if (context.topology.previousSibling) ids.push({ index: 0, kind: 'previous-sibling' });
	if (context.topology.nextSibling) ids.push({ index: 0, kind: 'next-sibling' });
	return ids;
}

function ownedRegionIds(context: ListContext, include: boolean): readonly EditRegionId[] {
	if (!include) return [];
	return context.topology.ownedBlocks.map((_block, index) => ({ index, kind: 'owned-block' }));
}

function boundaryRegionIds(
	boundaries: BoundaryPrerequisites,
	roles: readonly BoundaryRole[],
): readonly EditRegionId[] {
	return roles.flatMap((role) => {
		const boundary = boundaries[role];
		return boundary
			? [{ index: boundary.whitespaceIndex, kind: 'whitespace-boundary' as const }]
			: [];
	});
}

function resolveBackspacePrerequisites(
	context: ListContext,
	policy: PrerequisitePolicy,
): BackspacePrerequisites | null {
	const boundaries = resolveBoundaries(context);
	if (!boundaries) return null;
	const ownedIds = ownedRegionIds(context, policy.includeOwnedRegions);
	const regionIds = [
		...(policy.includeRelationshipRegions ? relationshipRegionIds(context) : [currentItemId]),
		...ownedIds,
		...boundaryRegionIds(boundaries, policy.boundaryRegionRoles),
	];
	if (!regionIds.every((id) => context.editScope.region(id))) return null;
	return { boundaries, ownedRegionIds: ownedIds };
}

function hasTopLevelReclassification(
	context: ListContext,
	before: NormalizedStructuralBoundary | null,
): boolean {
	return context.topology.depth > 0 &&
		before?.whitespace.newlineCount === 3 &&
		before.whitespace.lines.length === 2;
}

function matchesNonEmptyTopology(
	execution: ExecutionFor<BackspaceOperation>,
	before: NormalizedStructuralBoundary | null,
): boolean {
	const topLevel = execution.context.topology.depth === 0 ||
		hasTopLevelReclassification(execution.context, before);
	return topLevel ===
		(execution.intent.operation === 'backspace-top-level-content-start');
}

function keepsPhysicalPrefix(
	context: ListContext,
	firstOwnedBoundary: NormalizedStructuralBoundary | null,
): boolean {
	const firstOwned = context.topology.ownedBlocks[0];
	if (!firstOwned) return false;
	if (firstOwned.kind !== 'descendant') return true;
	return firstOwnedBoundary?.whitespace.newlineCount !== 1;
}

function hasExistingBlankBefore(boundary: NormalizedStructuralBoundary | null): boolean {
	return boundary !== null && boundary.whitespace.newlineCount >= 2;
}

function prefixReplacement(
	context: ListContext,
	before: NormalizedStructuralBoundary | null,
	firstOwnedBoundary: NormalizedStructuralBoundary | null,
	reclassified: boolean,
): string {
	const indent = desiredIndent(context, reclassified);
	if (reclassified) return indent;
	if (!context.topology.precedingContainer) return indent;
	if (hasExistingBlankBefore(before)) return indent;
	if (context.topology.depth === 0) return `\n${indent}`;
	if (context.topology.previousSibling) return `${physicalIndent(context)}\n${indent}`;
	if (context.topology.atDocumentEnd) return `${physicalIndent(context)}\n${indent}`;
	if (keepsPhysicalPrefix(context, firstOwnedBoundary)) return `${physicalIndent(context)}\n${indent}`;
	return `\n${indent}`;
}

function prefixFragment(
	execution: ExecutionFor<BackspaceOperation>,
	replacement: string,
): EditPlanFragment {
	return replacement.length === 0
		? convertItemToParagraph(
			execution.context,
			[currentItemId],
			execution.services.capabilities,
		)
		: replaceListBlockPrefix(
			execution.context.source,
			execution.context.editScope,
			currentItemId,
			execution.context.current,
			replacement,
			execution.services.capabilities,
		);
}

function indentationFragments(
	execution: ExecutionFor<BackspaceOperation>,
	delta: number,
	ids: readonly EditRegionId[],
): readonly EditPlanFragment[] {
	const { context } = execution;
	if (delta === 0 || ids.length === 0) return [];
	return [remapIndentation(
		context.source,
		context.editScope,
		ids,
		delta,
		execution.services.capabilities,
	)];
}

function followingWithoutOwnedBlocks(context: ListContext): string {
	if (context.topology.previousSibling) return `\n${physicalIndent(context)}\n`;
	return '\n\n';
}

function followingWithOwnedBlocks(
	context: ListContext,
	firstOwnedBoundary: NormalizedStructuralBoundary | null,
): string {
	const ordinary = `\n${physicalIndent(context)}\n`;
	if (context.topology.previousSibling) return ordinary;
	if (!context.topology.ownedBlocks.every((block) => block.kind === 'descendant')) return ordinary;
	if (context.topology.ownedBlocks.length <= 1) return ordinary;
	if (firstOwnedBoundary?.whitespace.newlineCount !== 1) return ordinary;
	return '\n\n';
}

function followingReplacement(
	context: ListContext,
	boundary: NormalizedStructuralBoundary,
	firstOwnedBoundary: NormalizedStructuralBoundary | null,
	reclassified: boolean,
): string {
	const fact = boundary.whitespace;
	const original = context.source.slice(fact.range);
	if (fact.toAnchor !== 'following-block') return original;
	if (!context.topology.nextSibling) return original;
	if (reclassified) return '\n\n\n';
	if (context.topology.depth === 0) return fact.newlineCount >= 2 ? original : '\n\n';
	if (context.topology.ownedBlocks.length === 0) return followingWithoutOwnedBlocks(context);
	return followingWithOwnedBlocks(context, firstOwnedBoundary);
}

function ownedBoundaryReplacement(
	context: ListContext,
	boundary: NormalizedStructuralBoundary,
	before: NormalizedStructuralBoundary | null,
	firstKind: OwnedBlock['kind'],
	original: string,
): string {
	const fact = boundary.whitespace;
	if (firstKind === 'additional-paragraph') return `\n${desiredIndent(context, false)}\n`;
	if (fact.newlineCount === 1) {
		return context.topology.previousSibling ? original : '\n\n';
	}
	if (context.topology.previousSibling && before?.whitespace.newlineCount === 2) {
		return original;
	}
	return `\n${physicalIndent(context)}\n`;
}

function firstOwnedReplacement(
	context: ListContext,
	boundary: NormalizedStructuralBoundary,
	before: NormalizedStructuralBoundary | null,
	reclassified: boolean,
): string {
	const fact = boundary.whitespace;
	const original = context.source.slice(fact.range);
	if (fact.fromAnchor !== 'current-marker-line') return original;
	if (fact.toAnchor !== 'owned-block:0') return original;
	if (reclassified) return original;
	if (context.topology.depth === 0) return original;
	const first = context.topology.ownedBlocks[0];
	if (!first) return original;
	if (first.kind === 'continuation') return original;
	return ownedBoundaryReplacement(context, boundary, before, first.kind, original);
}

function boundaryReplacement(
	context: ListContext,
	boundary: NormalizedStructuralBoundary,
	prerequisites: BoundaryPrerequisites,
	reclassified: boolean,
): string {
	const firstOwned = firstOwnedReplacement(
		context,
		boundary,
		prerequisites.preceding,
		reclassified,
	);
	if (firstOwned !== context.source.slice(boundary.whitespace.range)) return firstOwned;
	return followingReplacement(context, boundary, prerequisites['first-owned'], reclassified);
}

function forwardBoundaryFragments(
	execution: ExecutionFor<BackspaceOperation>,
	prerequisites: BoundaryPrerequisites,
	reclassified: boolean,
): readonly EditPlanFragment[] {
	const { context } = execution;
	const fragments: EditPlanFragment[] = [];
	const boundaries = [prerequisites['first-owned'], prerequisites.following].filter(
		(boundary): boundary is NormalizedStructuralBoundary => boundary !== null,
	);
	for (const boundary of boundaries) {
		const fact = boundary.whitespace;
		const replacement = boundaryReplacement(context, boundary, prerequisites, reclassified);
		if (replacement === context.source.slice(fact.range)) continue;
		fragments.push(rewriteWhitespaceBoundary(
			context.editScope,
			boundary.whitespace,
			{ index: boundary.whitespaceIndex, kind: 'whitespace-boundary' },
			replacement,
			execution.services.capabilities,
		));
	}
	return fragments;
}

function reclassifiedBeforeFragment(
	execution: ExecutionFor<BackspaceOperation>,
	before: NormalizedStructuralBoundary | null,
	reclassified: boolean,
): readonly EditPlanFragment[] {
	if (!reclassified || !before) return [];
	return [rewriteWhitespaceBoundary(
		execution.context.editScope,
		before.whitespace,
		{ index: before.whitespaceIndex, kind: 'whitespace-boundary' },
		'\n\n',
		execution.services.capabilities,
	)];
}

function fragmentStart(scope: EditScope, fragment: EditPlanFragment): number {
	return fragment.regionIds.reduce((start, id) => {
		const region = scope.region(id);
		return region ? Math.min(start, region.range.from) : start;
	}, Number.POSITIVE_INFINITY);
}

function orderedFragments(
	scope: EditScope,
	fragments: readonly EditPlanFragment[],
): readonly EditPlanFragment[] {
	return [...fragments].sort((left, right) => {
		return fragmentStart(scope, left) - fragmentStart(scope, right);
	});
}

function nonEmptyPlan(
	execution: ExecutionFor<BackspaceOperation>,
): EditPlan | null {
	const prerequisites = resolveBackspacePrerequisites(execution.context, {
		boundaryRegionRoles: ['preceding', 'first-owned', 'following'],
		includeOwnedRegions: true,
		includeRelationshipRegions: true,
	});
	if (!prerequisites) return null;
	const before = prerequisites.boundaries.preceding;
	if (!matchesNonEmptyTopology(execution, before)) return null;
	const reclassified = hasTopLevelReclassification(execution.context, before);
	const effectiveDelta = desiredIndent(execution.context, reclassified).length -
		(execution.context.current.content.from - execution.context.current.lineFrom);
	const boundaryFragments = forwardBoundaryFragments(
		execution,
		prerequisites.boundaries,
		reclassified,
	);
	const fragments = [
		...reclassifiedBeforeFragment(execution, before, reclassified),
		prefixFragment(execution, prefixReplacement(
			execution.context,
			before,
			prerequisites.boundaries['first-owned'],
			reclassified,
		)),
		...indentationFragments(execution, effectiveDelta, prerequisites.ownedRegionIds),
		...boundaryFragments,
	];
	return composeEditPlan(
		execution.intent.operation,
		execution.context.editScope,
		orderedFragments(execution.context.editScope, fragments),
		execution.services.capabilities,
	);
}

function repeatedLines(indent: string, count: number, caretLine: number): EmptyReplacement {
	const lines = Array.from({ length: count }, () => indent);
	return {
		caretOffset: lines.slice(0, caretLine + 1).join('\n').length,
		text: lines.join('\n'),
	};
}

function emptyNestedReplacement(context: ListContext): EmptyReplacement {
	const physical = physicalIndent(context);
	const desired = paragraphIndent(context.topology.precedingContainer);
	if (!context.topology.previousSibling && context.topology.ownedBlocks.length > 0) {
		return { caretOffset: physical.length + 1, text: `\n${physical}\n` };
	}
	if (!context.topology.previousSibling) return repeatedLines(physical, 3, 1);
	if (context.topology.ownedBlocks.length > 0) return repeatedLines(desired, 3, 1);
	const trailing = context.topology.atDocumentEnd ? '' : `\n${physical}`;
	return {
		caretOffset: physical.length + 1 + desired.length,
		text: `${physical}\n${desired}${trailing}`,
	};
}

function emptyTopLevelReplacement(context: ListContext): EmptyReplacement {
	const desired = paragraphIndent(context.topology.precedingContainer);
	if (context.topology.siblingPosition === 'only') return { caretOffset: 0, text: '' };
	if (!context.topology.previousSibling) return { caretOffset: 0, text: '\n' };
	if (context.topology.ownedBlocks.length > 0) return repeatedLines(desired, 3, 1);
	if (context.topology.atDocumentEnd) {
		return { caretOffset: desired.length + 1, text: `\n${desired}` };
	}
	return { caretOffset: desired.length + 1, text: `\n${desired}\n` };
}

function needsEmptyFollowingRewrite(context: ListContext, nested: boolean): boolean {
	return nested && !context.topology.previousSibling &&
		context.topology.ownedBlocks.length > 0 && context.topology.nextSibling !== null;
}

function emptyFollowingFragments(
	execution: ExecutionFor<BackspaceOperation>,
	boundary: NormalizedStructuralBoundary,
): readonly EditPlanFragment[] {
	return [rewriteWhitespaceBoundary(
		execution.context.editScope,
		boundary.whitespace,
		{ index: boundary.whitespaceIndex, kind: 'whitespace-boundary' },
		'\n\n',
		execution.services.capabilities,
	)];
}

function emptyPlan(
	execution: ExecutionFor<BackspaceOperation>,
	nested: boolean,
): EditPlan | null {
	const { context } = execution;
	const rewriteFollowing = needsEmptyFollowingRewrite(context, nested);
	const prerequisites = resolveBackspacePrerequisites(context, {
		boundaryRegionRoles: rewriteFollowing ? ['following'] : [],
		includeOwnedRegions: false,
		includeRelationshipRegions: false,
	});
	if (!prerequisites) return null;
	const followingBoundary = rewriteFollowing ? prerequisites.boundaries.following : null;
	if (rewriteFollowing && !followingBoundary) return null;
	const replacement = nested
		? emptyNestedReplacement(context)
		: emptyTopLevelReplacement(context);
	const delta = paragraphIndent(context.topology.precedingContainer).length -
		(context.current.content.from - context.current.lineFrom);
	const fragment = replaceEmptyItem(
		context,
		currentItemId,
		replacement.text,
		replacement.caretOffset,
		execution.services.capabilities,
		{ ownedIndentDelta: delta, replacePhysicalIndent: true },
	);
	const boundaryFragments = followingBoundary
		? emptyFollowingFragments(execution, followingBoundary)
		: [];
	return composeEditPlan(
		execution.intent.operation,
		execution.context.editScope,
		[fragment, ...boundaryFragments],
		execution.services.capabilities,
		emptyExceptionId(nested, execution.intent.operation),
	);
}

function handleNonEmpty<K extends BackspaceOperation>(
	execution: ExecutionFor<K>,
	operation: K,
): OperationResult {
	if (!validOperation(execution, operation) || execution.context.caretZone !== 'start') {
		return { kind: 'pass-through' };
	}
	const plan = nonEmptyPlan(execution);
	return plan ? editResult(plan) : { kind: 'pass-through' };
}

function handleEmpty<K extends BackspaceOperation>(
	execution: ExecutionFor<K>,
	operation: K,
	nested: boolean,
): OperationResult {
	if (!validOperation(execution, operation) || execution.context.caretZone !== 'empty') {
		return { kind: 'pass-through' };
	}
	if (nested !== (execution.context.topology.depth > 0)) return { kind: 'pass-through' };
	const plan = emptyPlan(execution, nested);
	return plan ? editResult(plan) : { kind: 'pass-through' };
}

export function backspaceNestedContentStart(
	execution: ExecutionFor<'backspace-nested-content-start'>,
): OperationResult {
	if (execution.context.caretZone === 'empty') {
		return handleEmpty(execution, 'backspace-nested-content-start', true);
	}
	return handleNonEmpty(execution, 'backspace-nested-content-start');
}

export function backspaceTopLevelContentStart(
	execution: ExecutionFor<'backspace-top-level-content-start'>,
): OperationResult {
	return handleNonEmpty(execution, 'backspace-top-level-content-start');
}

export function backspaceEmptyNested(
	execution: ExecutionFor<'backspace-empty-nested'>,
): OperationResult {
	return handleEmpty(execution, 'backspace-empty-nested', true);
}

export function backspaceEmptyTopLevel(
	execution: ExecutionFor<'backspace-empty-top-level'>,
): OperationResult {
	return handleEmpty(execution, 'backspace-empty-top-level', false);
}
