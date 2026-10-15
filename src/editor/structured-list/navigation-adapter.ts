import type { EditorState } from '@codemirror/state';
import { buildNavigationContext } from './context.js';
import type {
	ContextRuntime,
	NavigationDestination,
	StructuredListRangeIndex,
} from './model.js';
import type { NavigationServices } from './operations.js';
import { normalizeStructuredListCaretEndpoint } from './selection-protection.js';

export interface NavigationDestinationResolverOptions {
	readonly rangeIndex: StructuredListRangeIndex;
	readonly runtime: ContextRuntime;
	readonly state: EditorState;
}

export function createNavigationDestinationResolver(
	options: NavigationDestinationResolverOptions,
): NavigationServices['resolveDestination'] {
	return (rawPosition, bias): NavigationDestination | null => {
		const prefixPosition = options.rangeIndex.mapEndpoint(rawPosition.position, bias);
		const position = normalizeStructuredListCaretEndpoint(options.state, prefixPosition, bias);
		const visibleStart = options.rangeIndex.protectedRanges.some((range) => range.to === position);
		const assoc = visibleStart ? 1 : position === rawPosition.position ? rawPosition.assoc : bias;
		const context = buildNavigationContext(
			options.state,
			position,
			options.runtime,
			assoc,
		);
		return context ? { assoc, context, position } : null;
	};
}
