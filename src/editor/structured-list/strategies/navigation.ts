import { EditorSelection } from '@codemirror/state';
import type { VisualPosition } from '../../runtime/navigation-core.js';
import type { EditPlan, EditRegionId, EditScope } from '../edit-plan.js';
import type {
	NavigationContext,
	NavigationDestination,
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

function selectionAnchor(context: NavigationContext): number {
	return context.kind === 'list' ? context.list.selection.anchor : context.selection.anchor;
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

export const home: OperationHandler<'home'> = (execution) => {
	if (execution.intent.extend) return passThrough();
	const raw = execution.services.visual.visualLineStart(currentPoint(execution.context));
	const destination = resolved(execution.services, raw, 1);
	if (!destination) return passThrough();
	const ownsPrefix = execution.context.kind === 'list' &&
		execution.services.rangeIndex.protectedRanges.some(range =>
			range.from < range.to && range.to === destination.position);
	return finishHorizontal(execution, destination, ownsPrefix || destination.position !== caret(execution.context));
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
	let previousRaw = execution.services.visual.moveByChar(startRaw, false);
	const crossedPrefix = execution.services.rangeIndex.protectedRanges.find((range) =>
		range.from === previousRaw.position &&
		range.from <= startRaw.position && startRaw.position <= range.to);
	if (crossedPrefix) {
		previousRaw = execution.services.visual.moveByChar({
			assoc: -1,
			position: crossedPrefix.from,
		}, false);
		if (previousRaw.position >= crossedPrefix.from) return null;
	}
	const previous = resolved(execution.services, previousRaw, -1);
	if (!previous || previousRaw.position >= startRaw.position) return null;
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
	if (execution.intent.extend || execution.intent.direction !== 'down') return null;
	const end = sourceLength(execution.context);
	const id = terminalRegion(execution.context.editScope, end);
	if (!id) return null;
	const visualEnd = execution.services.visual.visualLineEnd(currentPoint(execution.context));
	return visualEnd.position === end
		? { kind: 'edit', plan: terminalEdit(execution, id) }
		: null;
}

function verticalDestination(
	execution: ExecutionFor<'up-down'>,
	raw: VisualPosition,
	bias: -1 | 1,
	goalX: number,
): NavigationDestination | null {
	const destination = resolved(execution.services, raw, bias);
	if (!destination || destination.position === raw.position) return destination;
	const aligned = execution.services.visual.alignGoalOnVisualLine?.(destination, goalX);
	return aligned ? resolved(execution.services, aligned, bias) : destination;
}

export const upDown: OperationHandler<'up-down'> = (execution) => {
	const terminal = terminalDownResult(execution);
	if (terminal) return terminal;
	const forward = verticalDirection(execution.intent.direction);
	if (forward === null) return passThrough();
	const goalX = verticalGoalX(execution);
	if (goalX === null) return passThrough();
	const current = currentPoint(execution.context);
	const raw = execution.services.visual.moveVertically(current, forward, goalX);
	const destination = verticalDestination(execution, raw, forward ? 1 : -1, goalX);
	if (!destination) return passThrough();
	execution.services.goalX.write(goalX);
	if (execution.intent.extend) {
		return { kind: 'selection', selection: EditorSelection.create([
			EditorSelection.range(selectionAnchor(execution.context), destination.position, goalX),
		]) };
	}
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
