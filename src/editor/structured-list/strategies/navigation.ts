import { EditorSelection } from '@codemirror/state';
import type { EditPlan, EditRegionId, EditScope } from '../edit-plan.js';
import type {
	NavigationContext,
	NavigationDestination,
	VisualPosition,
} from '../model.js';
import type {
	ExecutionFor,
	NavigationOperationId,
	NavigationServices,
	OperationHandler,
	OperationResult,
} from '../operations.js';

const passThrough = (): OperationResult => ({ kind: 'pass-through' });

function caret(context: NavigationContext): number {
	return context.kind === 'list' ? context.list.caret : context.caret;
}

function currentPoint(context: NavigationContext): VisualPosition {
	return { assoc: context.assoc, position: caret(context) };
}

function samePoint(left: VisualPosition, right: VisualPosition): boolean {
	return left.position === right.position && left.assoc === right.assoc;
}

function sourceLength(context: NavigationContext): number {
	return context.kind === 'list' ? context.list.source.length : context.source.length;
}

function selection(
	destination: NavigationDestination,
): OperationResult {
	return {
		kind: 'selection',
		selection: EditorSelection.create([
			EditorSelection.cursor(destination.position, destination.assoc),
		]),
	};
}

function resolved(
	services: NavigationServices,
	rawPosition: VisualPosition,
	bias: -1 | 1,
): NavigationDestination | null {
	return services.resolveDestination(rawPosition, bias);
}

function finishHorizontal(
	execution: ExecutionFor<NavigationOperationId>,
	destination: NavigationDestination,
	moved: boolean,
): OperationResult {
	if (!moved) return passThrough();
	execution.services.goalX.write(null);
	return selection(destination);
}

function continuationHomeDestination(
	execution: ExecutionFor<'home'>,
	destination: NavigationDestination,
): NavigationDestination | null {
	if (execution.context.kind !== 'list') return destination;
	const current = currentPoint(execution.context);
	const continuation = execution.context.list.topology.ownedBlocks.find((block) =>
		block.kind === 'continuation' &&
		block.range.from <= current.position &&
		current.position <= block.range.to);
	if (!continuation) return destination;
	const contentStart = continuation.range.from + continuation.indentText.length;
	if (destination.position < continuation.range.from || destination.position >= contentStart) {
		return destination;
	}
	return resolved(execution.services, { assoc: 1, position: contentStart }, 1);
}

export const home: OperationHandler<'home'> = (execution) => {
	if (execution.intent.extend) return passThrough();
	const raw = execution.services.visual.visualLineStart(currentPoint(execution.context));
	const rawDestination = resolved(execution.services, raw, 1);
	if (!rawDestination) return passThrough();
	const destination = continuationHomeDestination(execution, rawDestination);
	if (!destination) return passThrough();
	return finishHorizontal(execution, destination, destination.position !== caret(execution.context));
};

export const end: OperationHandler<'end'> = (execution) => {
	if (execution.intent.extend) return passThrough();
	const current = currentPoint(execution.context);
	const raw = execution.services.visual.visualLineEnd(current);
	const destination = resolved(execution.services, raw, -1);
	if (!destination) return passThrough();
	return finishHorizontal(execution, destination, destination.position !== current.position);
};

function previousVisualLine(
	execution: ExecutionFor<'left-content-start'>,
	startRaw: VisualPosition,
): NavigationDestination | null {
	const previousRaw = execution.services.visual.moveByChar(startRaw, false);
	const previous = resolved(execution.services, previousRaw, -1);
	if (!previous || samePoint(previousRaw, startRaw)) return null;
	const endRaw = execution.services.visual.visualLineEnd(previous);
	return resolved(execution.services, endRaw, -1);
}

export const leftAtContentStart: OperationHandler<'left-content-start'> = (execution) => {
	if (execution.intent.extend) return passThrough();
	const current = currentPoint(execution.context);
	const startRaw = execution.services.visual.visualLineStart(current);
	const start = resolved(execution.services, startRaw, 1);
	if (!start) return passThrough();
	if (start.position !== current.position) {
		const raw = execution.services.visual.moveByChar(current, false);
		const destination = resolved(execution.services, raw, -1);
		return destination
			? finishHorizontal(execution, destination, !samePoint(destination, current))
			: passThrough();
	}
	const destination = previousVisualLine(execution, startRaw);
	return destination ? finishHorizontal(execution, destination, true) : passThrough();
};

function nextVisualLine(
	execution: ExecutionFor<'right'>,
	endRaw: VisualPosition,
): NavigationDestination | null {
	const nextRaw = execution.services.visual.moveByChar(endRaw, true);
	if (samePoint(nextRaw, endRaw)) return null;
	const next = resolved(execution.services, nextRaw, 1);
	if (!next) return null;
	const startRaw = execution.services.visual.visualLineStart(next);
	return resolved(execution.services, startRaw, 1);
}

export const right: OperationHandler<'right'> = (execution) => {
	if (execution.intent.extend) return passThrough();
	const current = currentPoint(execution.context);
	const endRaw = execution.services.visual.visualLineEnd(current);
	const lineEnd = resolved(execution.services, endRaw, -1);
	if (!lineEnd) return passThrough();
	if (lineEnd.position !== current.position) {
		const raw = execution.services.visual.moveByChar(current, true);
		const destination = resolved(execution.services, raw, 1);
		return destination
			? finishHorizontal(execution, destination, !samePoint(destination, current))
			: passThrough();
	}
	const destination = nextVisualLine(execution, endRaw);
	return destination ? finishHorizontal(execution, destination, true) : passThrough();
};

function terminalRegionId(scope: EditScope): EditRegionId | null {
	if (scope.mode !== 'editable') return null;
	if (scope.regionIds.length !== 1) return null;
	const id = scope.regionIds[0];
	if (!id) return null;
	if (id.kind !== 'terminal-insertion') return null;
	if (id.index !== 0) return null;
	return id;
}

function terminalRegion(scope: EditScope, sourceEnd: number): EditRegionId | null {
	const id = terminalRegionId(scope);
	if (!id) return null;
	const region = scope.region(id);
	if (!region) return null;
	if (region.range.from !== sourceEnd) return null;
	if (region.range.to !== sourceEnd) return null;
	return id;
}

function terminalEdit(
	execution: ExecutionFor<'up-down'>,
	id: EditRegionId,
): EditPlan {
	const from = sourceLength(execution.context);
	return {
		changes: [{ from, insert: '\n', to: from }],
		exceptionId: 'SLX-005',
		ownership: { regionIds: [id] },
		selection: EditorSelection.single(from + 1),
	};
}

function verticalGoalX(execution: ExecutionFor<'up-down'>): number | null {
	const stored = execution.services.goalX.read();
	if (stored !== null) return stored;
	return execution.services.visual.coordsAtPos(currentPoint(execution.context))?.left ?? null;
}

function verticalDirection(
	direction: ExecutionFor<'up-down'>['intent']['direction'],
): boolean | null {
	if (direction === 'down') return true;
	if (direction === 'up') return false;
	return null;
}

function finishVertical(
	current: VisualPosition,
	raw: VisualPosition,
	destination: NavigationDestination,
): OperationResult {
	if (!samePoint(raw, current) || !samePoint(destination, current)) {
		return selection(destination);
	}
	return passThrough();
}

function terminalDownResult(
	execution: ExecutionFor<'up-down'>,
): OperationResult | null {
	if (execution.intent.direction !== 'down') return null;
	const end = sourceLength(execution.context);
	const id = terminalRegion(execution.context.editScope, end);
	if (!id) return null;
	const visualEnd = execution.services.visual.visualLineEnd(currentPoint(execution.context));
	return visualEnd.position === end
		? { kind: 'edit', plan: terminalEdit(execution, id) }
		: null;
}

export const upDown: OperationHandler<'up-down'> = (execution) => {
	if (execution.intent.extend) return passThrough();
	const terminal = terminalDownResult(execution);
	if (terminal) return terminal;
	const forward = verticalDirection(execution.intent.direction);
	if (forward === null) return passThrough();
	const goalX = verticalGoalX(execution);
	if (goalX === null) return passThrough();
	const current = currentPoint(execution.context);
	const raw = execution.services.visual.moveVertically(current, forward, goalX);
	const destination = resolved(execution.services, raw, 1);
	if (!destination) return passThrough();
	execution.services.goalX.write(goalX);
	return finishVertical(current, raw, destination);
};

function sameItem(
	context: ExecutionFor<'click-prefix-gutter'>['context'],
	destination: NavigationDestination,
): boolean {
	if (destination.context.kind !== 'list') return false;
	const expected = context.current.item;
	const actual = destination.context.list.current.item;
	return expected.from === actual.from && expected.to === actual.to;
}

export const clickPrefixGutter: OperationHandler<'click-prefix-gutter'> = (execution) => {
	const inProtectedRange = execution.services.rangeIndex.protectedRanges.some((range) =>
		range.from <= execution.intent.documentPosition &&
		execution.intent.documentPosition <= range.to);
	if (!inProtectedRange) {
		return passThrough();
	}
	const destination = resolved(execution.services, {
		assoc: 0,
		position: execution.intent.documentPosition,
	}, 1);
	if (!destination || !sameItem(execution.context, destination)) return passThrough();
	execution.services.goalX.write(null);
	return {
		kind: 'selection',
		selection: EditorSelection.create([
			EditorSelection.cursor(destination.position, destination.assoc),
		]),
	};
};
