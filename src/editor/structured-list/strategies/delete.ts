import type { EditPlanFragment, EditRegionId } from '../edit-plan.js';
import { sameFollowingBoundary } from '../context-boundaries.js';
import type { ListContext, NormalizedStructuralBoundary } from '../model.js';
import type { ExecutionFor, OperationResult } from '../operations.js';
import {
	composeEditPlan,
	deleteVisibleCharacter,
	mergeFollowingBlock,
	removeStructuralBoundary,
} from '../primitives.js';

type MergeBoundaryKind =
	| 'same-level-item'
	| 'descendant-item'
	| 'continuation'
	| 'additional-paragraph'
	| 'ordinary-paragraph'
	| 'terminal-newline';

interface MergeBoundaryPolicy {
	readonly primitive: 'merge' | 'remove';
}

const mergeBoundaryTable = {
	'additional-paragraph': { primitive: 'merge' },
	continuation: { primitive: 'merge' },
	'descendant-item': { primitive: 'merge' },
	'ordinary-paragraph': { primitive: 'remove' },
	'same-level-item': { primitive: 'merge' },
	'terminal-newline': { primitive: 'remove' },
} as const satisfies Readonly<Record<MergeBoundaryKind, MergeBoundaryPolicy>>;

interface CharacterPrerequisites {
	readonly direction: 'backward' | 'forward';
	readonly kind: 'character';
	readonly regionId: EditRegionId;
}

interface BoundaryPrerequisites {
	readonly boundary: NormalizedStructuralBoundary;
	readonly boundaryKind: MergeBoundaryKind;
	readonly kind: 'boundary';
	readonly regionId: EditRegionId;
}

type DeletePrerequisites = CharacterPrerequisites | BoundaryPrerequisites;

const sameRange = (
	left: { readonly from: number; readonly to: number },
	right: { readonly from: number; readonly to: number },
): boolean => left.from === right.from && left.to === right.to;

function matchingRegion(
	context: ListContext,
	id: EditRegionId,
	range: { readonly from: number; readonly to: number },
): EditRegionId | null {
	const region = context.editScope.region(id);
	return region && sameRange(region.range, range) ? id : null;
}

function characterPrerequisites(
	execution: ExecutionFor<'backspace-delete-inside-content'>,
): CharacterPrerequisites | null {
	const { caret, current } = execution.context;
	const direction = execution.intent.direction;
	const inside = direction === 'backward'
		? current.content.from < caret && caret <= current.content.to
		: direction === 'forward' && current.content.from <= caret && caret < current.content.to;
	if (!inside || direction === null) return null;
	const regionId = matchingRegion(
		execution.context,
		{ index: null, kind: 'current-content' },
		current.content,
	);
	return regionId ? { direction, kind: 'character', regionId } : null;
}

function canonicalBoundary(
	context: ListContext,
	direction: 'backward' | 'forward' | null,
): NormalizedStructuralBoundary | null {
	const boundary = direction !== 'forward' || context.caretContent.kind === 'marker-line'
		? context.topology.followingStructuralBoundary
		: context.topology.structuralBoundaries.find(candidate =>
			candidate.whitespace.fromAnchor === `owned-block:${context.caretContent.ownedBlockIndex}` &&
			candidate.removalRange.from === context.caretContent.range.to);
	if (!boundary) return null;
	const matches = context.topology.structuralBoundaries.filter((candidate) =>
		sameNormalizedBoundaryIdentity(candidate, boundary));
	return matches.length === 1 ? boundary : null;
}

function sameNormalizedBoundaryIdentity(
	left: NormalizedStructuralBoundary,
	right: NormalizedStructuralBoundary,
): boolean {
	if (left === right) return true;
	return sameBoundaryCore(left, right) && sameWhitespaceIdentity(left, right);
}

function sameBoundaryCore(
	left: NormalizedStructuralBoundary,
	right: NormalizedStructuralBoundary,
): boolean {
	return left.id === right.id &&
		left.whitespaceIndex === right.whitespaceIndex &&
		sameRange(left.removalRange, right.removalRange) &&
		sameFollowingBoundary(left.following, right.following);
}

function sameWhitespaceIdentity(
	left: NormalizedStructuralBoundary,
	right: NormalizedStructuralBoundary,
): boolean {
	return left.whitespace.fromAnchor === right.whitespace.fromAnchor &&
		left.whitespace.toAnchor === right.whitespace.toAnchor &&
		left.whitespace.newlineCount === right.whitespace.newlineCount &&
		left.whitespace.atDocumentEnd === right.whitespace.atDocumentEnd &&
		sameRange(left.whitespace.range, right.whitespace.range) &&
		sameWhitespaceLines(left.whitespace.lines, right.whitespace.lines);
}

type NormalizedWhitespaceLine = NormalizedStructuralBoundary['whitespace']['lines'][number];

function sameWhitespaceLines(
	left: readonly NormalizedWhitespaceLine[],
	right: readonly NormalizedWhitespaceLine[],
): boolean {
	if (left.length !== right.length) return false;
	return left.every((line, index) => {
		const candidate = right[index];
		return candidate !== undefined && sameWhitespaceLine(line, candidate);
	});
}

function sameWhitespaceLine(
	left: NormalizedWhitespaceLine,
	right: NormalizedWhitespaceLine,
): boolean {
	return left.kind === right.kind && left.text === right.text &&
		sameRange(left.range, right.range);
}

function listBoundaryKind(
	boundary: NormalizedStructuralBoundary,
): MergeBoundaryKind | null {
	if (boundary.following.kind !== 'list-item') return null;
	if (boundary.whitespace.toAnchor.startsWith('owned-block:')) return 'descendant-item';
	return boundary.whitespace.toAnchor === 'following-block' ? 'same-level-item' : null;
}

function confirmedTerminalCount(count: unknown): count is 1 | 2 {
	return count === 1 || count === 2;
}

function boundaryKind(boundary: NormalizedStructuralBoundary): MergeBoundaryKind | null {
	switch (boundary.following.kind) {
		case 'list-item': return listBoundaryKind(boundary);
		case 'continuation': return 'continuation';
		case 'additional-paragraph': return 'additional-paragraph';
		case 'ordinary-paragraph': return 'ordinary-paragraph';
		case 'terminal-newlines':
			return confirmedTerminalCount(boundary.following.count) ? 'terminal-newline' : null;
		default: return null;
	}
}

function directionMatchesBoundary(
	execution: ExecutionFor<'backspace-delete-inside-content'>,
	boundary: NormalizedStructuralBoundary,
	kind: MergeBoundaryKind,
): boolean {
	if (execution.intent.direction === 'forward') {
		return execution.context.caret === execution.context.caretContent.range.to;
	}
	const backwardKind = kind === 'continuation' || kind === 'additional-paragraph';
	return execution.intent.direction === 'backward' && backwardKind &&
		execution.context.caret === boundary.removalRange.to;
}

function boundaryRegionId(
	context: ListContext,
	boundary: NormalizedStructuralBoundary,
	kind: MergeBoundaryKind,
): EditRegionId | null {
	const expectedKind = kind === 'terminal-newline'
		? 'terminal-newlines'
		: 'structural-boundary';
	const matching = context.editScope.regionIds.filter((id) =>
		id.kind === expectedKind && matchingRegion(context, id, boundary.removalRange));
	return matching.length === 1 ? matching[0]! : null;
}

function boundaryPrerequisites(
	execution: ExecutionFor<'backspace-delete-inside-content'>,
): BoundaryPrerequisites | null {
	const canonical = canonicalBoundary(execution.context, execution.intent.direction);
	if (!canonical) return null;
	const kind = boundaryKind(canonical);
	if (!kind || !directionMatchesBoundary(execution, canonical, kind)) return null;
	const regionId = boundaryRegionId(
		execution.context,
		canonical,
		kind,
	);
	return regionId ? {
		boundary: canonical,
		boundaryKind: kind,
		kind: 'boundary',
		regionId,
	} : null;
}

function resolveDeletePrerequisites(
	execution: ExecutionFor<'backspace-delete-inside-content'>,
): DeletePrerequisites | null {
	return characterPrerequisites(execution) ?? boundaryPrerequisites(execution);
}

function boundaryFragment(
	execution: ExecutionFor<'backspace-delete-inside-content'>,
	prerequisites: BoundaryPrerequisites,
): EditPlanFragment {
	const policy = mergeBoundaryTable[prerequisites.boundaryKind];
	return policy.primitive === 'merge'
		? mergeFollowingBlock(
			execution.context,
			prerequisites.boundary,
			[prerequisites.regionId],
		)
		: removeStructuralBoundary(
			execution.context.editScope,
			prerequisites.boundary,
			prerequisites.regionId,
		);
}

function executeDeleteDecision(
	execution: ExecutionFor<'backspace-delete-inside-content'>,
	prerequisites: DeletePrerequisites,
): OperationResult {
	const fragment = prerequisites.kind === 'character'
		? deleteVisibleCharacter(
			execution.context,
			prerequisites.regionId,
			prerequisites.direction,
		)
		: boundaryFragment(execution, prerequisites);
	return {
		kind: 'edit',
		plan: composeEditPlan(
			'backspace-delete-inside-content',
			execution.context.editScope,
			[fragment],
		),
	};
}

export function backspaceDeleteInsideContent(
	execution: ExecutionFor<'backspace-delete-inside-content'>,
): OperationResult {
	const prerequisites = resolveDeletePrerequisites(execution);
	if (!prerequisites) return { kind: 'pass-through' };
	return executeDeleteDecision(execution, prerequisites);
}
