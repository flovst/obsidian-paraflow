import type { EditorState } from '@codemirror/state';
import type { VisualPosition } from '../runtime/navigation-core.js';
import { buildNavigationContext } from './context.js';
import type {
	ContextRuntime,
	NavigationDestination,
	StructuredListRangeIndex,
} from './model.js';
import type { NavigationServices } from './operations.js';

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
