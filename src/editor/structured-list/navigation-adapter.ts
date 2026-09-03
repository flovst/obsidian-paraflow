import { EditorSelection, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { buildNavigationContext } from './context.js';
import type {
	ContextRuntime,
	NavigationDestination,
	StructuredListRangeIndex,
	VisualPosition,
} from './model.js';
import type {
	GoalXStore,
	NavigationServices,
	VisualNavigationAdapter,
} from './operations.js';

class GoalXPluginValue implements GoalXStore {
	private value: number | null = null;

	read(): number | null {
		return this.value;
	}

	write(value: number | null): void {
		this.value = value;
	}

	update(update: ViewUpdate): void {
		if (update.docChanged) this.value = null;
	}
}

const goalXPlugin = ViewPlugin.define(() => new GoalXPluginValue());

export function createGoalXStoreExtension(): Extension {
	return goalXPlugin;
}

export function goalXStoreFor(view: EditorView): GoalXStore | null {
	return view.plugin(goalXPlugin) ?? null;
}

export function createVisualNavigationAdapter(view: EditorView): VisualNavigationAdapter {
	const cursor = (point: VisualPosition, goalX?: number) =>
		EditorSelection.cursor(point.position, point.assoc, undefined, goalX);
	const point = (range: ReturnType<typeof EditorSelection.cursor>): VisualPosition => ({
		assoc: range.assoc,
		position: range.head,
	});
	return {
		coordsAtPos(position) {
			const coordinates = view.coordsAtPos(position.position, position.assoc < 0 ? -1 : 1);
			return coordinates ? {
				left: coordinates.left - view.contentDOM.getBoundingClientRect().left,
				top: coordinates.top,
			} : null;
		},
		moveByChar(position, forward) {
			return point(view.moveByChar(cursor(position), forward));
		},
		moveVertically(position, forward, goalX) {
			return point(view.moveVertically(cursor(position, goalX), forward));
		},
		posAtCoords(coordinates) {
			const position = view.posAtCoords(coordinates);
			return position === null ? null : { assoc: 0, position };
		},
		visualLineEnd(position) {
			return point(view.moveToLineBoundary(cursor(position), true, true));
		},
		visualLineStart(position) {
			return point(view.moveToLineBoundary(cursor(position), false, true));
		},
	};
}

export interface NavigationDestinationResolverOptions {
	readonly rangeIndex: StructuredListRangeIndex;
	readonly runtime: ContextRuntime;
	readonly state: EditorState;
}

function legalDestinationPosition(
	position: number,
	rangeIndex: StructuredListRangeIndex,
	context: NonNullable<ReturnType<typeof buildNavigationContext>>,
): number {
	if (context.kind !== 'list') return position;
	const block = context.list.current;
	const physicalPrefix = rangeIndex.protectedRanges.find((range) =>
		range.from === block.lineFrom && range.to === block.content.from);
	if (!physicalPrefix) return position;
	return position >= physicalPrefix.from && position < physicalPrefix.to
		? physicalPrefix.to
		: position;
}

function mapProtectedStartBoundary(
	position: VisualPosition,
	rangeIndex: StructuredListRangeIndex,
): VisualPosition {
	const range = rangeIndex.protectedRanges.find((candidate) => candidate.from === position.position);
	return range ? { assoc: 1, position: range.to } : position;
}

export function createNavigationDestinationResolver(
	options: NavigationDestinationResolverOptions,
): NavigationServices['resolveDestination'] {
	return (rawPosition, bias): NavigationDestination | null => {
		const mappedPosition = options.rangeIndex.mapEndpoint(rawPosition.position, bias);
		const mapped = mappedPosition === rawPosition.position
			? rawPosition
			: { assoc: bias, position: mappedPosition };
		const endpoint = mapProtectedStartBoundary(mapped, options.rangeIndex);
		const initial = buildNavigationContext(
			options.state,
			endpoint.position,
			options.runtime,
			endpoint.assoc,
		);
		if (!initial) return null;
		const position = legalDestinationPosition(endpoint.position, options.rangeIndex, initial);
		if (position === endpoint.position) return { ...endpoint, context: initial };
		const assoc = bias;
		const context = buildNavigationContext(options.state, position, options.runtime, assoc);
		return context ? { assoc, context, position } : null;
	};
}
