import { Prec, type Extension } from '@codemirror/state';
import { keymap, type EditorView, type KeyBinding } from '@codemirror/view';
import { buildListContext, buildNavigationContext } from './context.js';
import { applyOperationResult } from './edit-plan.js';
import { createNavigationDestinationResolver } from './navigation-adapter.js';
import type { ContextRuntime } from './model.js';
import {
	executeRegisteredOperation,
	type NavigationIntent,
	type NavigationOperationId,
	type StructuralIntent,
	type StructuralOperationId,
	type StructuredListExtensionOptions,
	type StructuredListRuntimeServices,
} from './operations.js';
import { classifyCurrentSelectionMode } from './selection-protection.js';

type DispatchIntent =
	| StructuralIntent<StructuralOperationId>
	| NavigationIntent<NavigationOperationId>;

function editIntent(intent: DispatchIntent): ContextRuntime['editIntent'] {
	if (intent.family === 'structural') return 'structural';
	return intent.operation === 'up-down' ? 'conditional-terminal' : 'none';
}

function contextRuntime(
	view: EditorView,
	intent: DispatchIntent,
	services: StructuredListRuntimeServices,
): ContextRuntime {
	return {
		editIntent: editIntent(intent),
		imeComposing: view.composing,
		operation: intent.operation,
		scopeFactory: services.scopeFactory,
		selectionMode: classifyCurrentSelectionMode(view.state),
		selectionsCount: view.state.selection.ranges.length,
	};
}

function navigationServices(
	view: EditorView,
	runtime: ContextRuntime,
	services: StructuredListRuntimeServices,
) {
	const navigation = services.navigation;
	return {
		...navigation,
		resolveDestination: createNavigationDestinationResolver({
			rangeIndex: navigation.rangeIndex,
			runtime,
			state: view.state,
		}),
	};
}

function dispatchNavigation<K extends NavigationOperationId>(
	view: EditorView,
	intent: NavigationIntent<K>,
	runtime: ContextRuntime,
	services: StructuredListRuntimeServices,
): boolean {
	const context = buildNavigationContext(view.state, view.state.selection.main.head, runtime);
	if (!context) return false;
	const executionServices = navigationServices(view, runtime, services);
	const result = executeRegisteredOperation({ context, intent, services: executionServices });
	return applyOperationResult(
		view,
		intent.operation,
		context.editScope,
		result,
		services.result,
	);
}

function dispatchStructural<K extends StructuralOperationId>(
	view: EditorView,
	intent: StructuralIntent<K>,
	runtime: ContextRuntime,
	services: StructuredListRuntimeServices,
): boolean {
	const context = buildListContext(view.state, view.state.selection.main.head, runtime);
	if (!context) return false;
	const result = executeRegisteredOperation({ context, intent, services: services.structural });
	return applyOperationResult(
		view,
		intent.operation,
		context.editScope,
		result,
		services.result,
	);
}

export function dispatchOperation(
	view: EditorView,
	intent: DispatchIntent,
	options: StructuredListExtensionOptions,
): boolean {
	if (!options.isLivePreview(view.state)) return false;
	const services = options.services.forView(view);
	const runtime = contextRuntime(view, intent, services);
	return intent.family === 'navigation'
		? dispatchNavigation(view, intent, runtime, services)
		: dispatchStructural(view, intent, runtime, services);
}

function structuralBinding<K extends StructuralOperationId>(
	key: string,
	operation: K,
	direction: StructuralIntent<K>['direction'],
	options: StructuredListExtensionOptions,
): KeyBinding {
	return {
		key,
		run: (view) => dispatchOperation(view, {
			direction,
			family: 'structural',
			operation,
		}, options),
	};
}

function navigationBinding<K extends NavigationOperationId>(
	key: string,
	operation: K,
	direction: NavigationIntent<K>['direction'],
	options: StructuredListExtensionOptions,
): KeyBinding {
	return {
		key,
		run: (view) => dispatchOperation(view, {
			direction,
			extend: false,
			family: 'navigation',
			operation,
		}, options),
	};
}

function structuralBindings(options: StructuredListExtensionOptions): readonly KeyBinding[] {
	return [
		structuralBinding('Backspace', 'backspace-empty-nested', 'backward', options),
		structuralBinding('Backspace', 'backspace-empty-top-level', 'backward', options),
		structuralBinding('Backspace', 'backspace-nested-content-start', 'backward', options),
		structuralBinding('Backspace', 'backspace-top-level-content-start', 'backward', options),
		structuralBinding('Backspace', 'backspace-delete-inside-content', 'backward', options),
		structuralBinding('Delete', 'backspace-delete-inside-content', 'forward', options),
		structuralBinding('Enter', 'enter-empty-nested', null, options),
		structuralBinding('Enter', 'enter-empty-top-level', null, options),
		structuralBinding('Enter', 'enter-task-non-empty', null, options),
		structuralBinding('Enter', 'enter-non-empty', null, options),
		structuralBinding('Shift-Enter', 'shift-enter', null, options),
		structuralBinding('Tab', 'tab', null, options),
		structuralBinding('Shift-Tab', 'shift-tab', null, options),
	];
}

function navigationBindings(options: StructuredListExtensionOptions): readonly KeyBinding[] {
	return [
		navigationBinding('Home', 'home', null, options),
		navigationBinding('ArrowLeft', 'left-content-start', 'backward', options),
		navigationBinding('ArrowRight', 'right', 'forward', options),
		navigationBinding('End', 'end', null, options),
		navigationBinding('ArrowUp', 'up-down', 'up', options),
		navigationBinding('ArrowDown', 'up-down', 'down', options),
	];
}

export function createStructuredListKeymap(
	options: StructuredListExtensionOptions,
): Extension {
	return Prec.highest(keymap.of([
		...structuralBindings(options),
		...navigationBindings(options),
	]));
}
