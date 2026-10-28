import { EditorSelection, Prec, type Extension } from '@codemirror/state';
import { keymap, type EditorView, type KeyBinding } from '@codemirror/view';
import { classifyCurrentSelectionMode, requireCompositionState } from '../runtime/input-state.js';
import { dispatchParagraphSelection, paragraphNavigationAnnotation, type ParagraphNavigationOperationId } from '../paragraph/edit-plan.js';
import { buildListContext, buildNavigationContext, buildSelectionContext } from './context.js';
import { applyOperationResult } from './edit-plan.js';
import { createNavigationDestinationResolver } from './navigation-adapter.js';
import { planSelectionIndent } from './selection-indent.js';
import { projectedQuoteMarkerOffset } from './projection.js';
import { headingBodyLineAt } from '../paragraph/heading-projection.js';
import { normalizeParagraphSelectionEndpoint } from '../paragraph/selection-protection.js';
import { hasMathCreationDraft } from '../math/native-ownership.js';
import { calloutTitleEnd, collapsedCalloutRange } from '../callout/presentation.js';
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
	if (exitCollapsedCallout(view, intent, executionServices)) return true;
	const result = executeRegisteredOperation({ context, intent, services: executionServices });
	if (result.kind === 'selection') {
		const operation: ParagraphNavigationOperationId = intent.operation === 'left-content-start'
			? 'left' : intent.operation === 'up-down'
				? intent.direction === 'up' ? 'up' : 'down'
				: intent.operation;
		dispatchParagraphSelection(view, operation, result.selection);
		return true;
	}
	return applyOperationResult(
		view,
		intent.operation,
		context.editScope,
		result,
		services.result,
	);
}

function exitCollapsedCallout(view: EditorView, intent: NavigationIntent<NavigationOperationId>, services: ReturnType<typeof navigationServices>): boolean {
	if (intent.operation !== 'right' || intent.extend) return false;
	const current = view.state.selection.main;
	if (!current.empty) return false;
	const folded = collapsedCalloutRange(view.state, current.head);
	if (!folded || current.head !== folded.from) return false;
	if (folded.to === view.state.doc.length) return true;
	const position = normalizeParagraphSelectionEndpoint(view.state, folded.to + 1, 1);
	const destination = services.resolveDestination({ position, assoc: 1 }, 1);
	if (!destination) return false;
	dispatchParagraphSelection(view, 'right', EditorSelection.create([
		EditorSelection.cursor(destination.position, destination.assoc),
	]));
	return true;
}

function dispatchStructural<K extends StructuralOperationId>(
	view: EditorView,
	intent: StructuralIntent<K>,
	runtime: ContextRuntime,
	services: StructuredListRuntimeServices,
): boolean {
	if (intent.operation.startsWith('enter-') && hasMathCreationDraft(view.state)) return false;
	if (intent.operation === 'tab' || intent.operation === 'shift-tab') {
		const selection = planSelectionIndent(view.state, intent.operation, runtime, services.structural.prefixPolicy);
		if (selection) return applyOperationResult(view, intent.operation, selection.scope, selection.result, services.result);
	}
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
	if (!options.isLivePreview(view.state) || options.isSurface?.(view) === false) return false;
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
		run: (view) => operation === 'home' || operation === 'end'
			? dispatchBoundaryNavigation(view, options, operation) : dispatchOperation(view, {
			direction,
			extend: false,
			family: 'navigation',
			operation,
		}, options),
		shift: operation === 'up-down' ? (view) => dispatchOperation(view, {
			direction,
			extend: true,
			family: 'navigation',
			operation,
		}, options) : operation === 'end' || operation === 'home'
			? (view) => dispatchNativeShiftBoundary(view, options, operation, true) : undefined,
	};
}

function boundaryHead(view: EditorView, range: EditorSelection['main'], forward: boolean) {
	const line = view.lineBlockAt(range.head);
	let head = view.moveToLineBoundary(range, forward);
	if (head.head === range.head && head.head !== (forward ? line.to : line.from)) head = view.moveToLineBoundary(range, forward, false);
	if (forward || head.head !== line.from) return head;
	const spaces = /^\s*/u.exec(view.state.sliceDoc(line.from, Math.min(line.from + 100, line.to)))![0].length;
	return spaces && range.head !== line.from + spaces ? EditorSelection.cursor(line.from + spaces) : head;
}

function dispatchBoundaryNavigation(view: EditorView, options: StructuredListExtensionOptions, operation: 'home' | 'end'): boolean {
	if (operation === 'end' && calloutTitleEnd(view.state, view.state.selection.main.head) !== null) return false;
	if (headingBodyLineAt(view.state, view.state.selection.main.head)) return false;
	if (classifyCurrentSelectionMode(view.state) === 'continuous') return dispatchNativeShiftBoundary(view, options, operation, false);
	return dispatchOperation(view, { family: 'navigation', operation, direction: null, extend: false }, options) ||
		dispatchNativeShiftBoundary(view, options, operation, false);
}

function boundarySelection(view: EditorView, forward: boolean, extend: boolean): EditorSelection {
	return EditorSelection.create(view.state.selection.ranges.map(range => {
		const head = boundaryHead(view, range, forward);
		return extend ? EditorSelection.range(range.anchor, head.head, head.goalColumn, head.bidiLevel || undefined) : head;
	}), view.state.selection.mainIndex);
}

function boundaryContext(view: EditorView, options: StructuredListExtensionOptions, operation: 'home' | 'end', mode: ContextRuntime['selectionMode']) {
	if (headingBodyLineAt(view.state, view.state.selection.main.head)) return null;
	const services = options.services.forView(view);
	const runtime = contextRuntime(view, { family: 'navigation', operation, direction: null, extend: true }, services);
	const context = mode === 'caret'
		? buildListContext(view.state, view.state.selection.main.head, runtime)
		: buildSelectionContext(view.state, view.state.selection, { ...runtime, operation: 'normal-selection' });
	if (context) return context;
	const range = view.state.selection.main;
	if (view.state.doc.lineAt(range.anchor).number !== view.state.doc.lineAt(range.head).number ||
		projectedQuoteMarkerOffset(view.state, range.anchor) === null) return null;
	return projectedQuoteMarkerOffset(view.state, range.head);
}

function ownsBoundarySurface(view: EditorView, options: StructuredListExtensionOptions, operation: 'home' | 'end'): boolean {
	return options.isLivePreview(view.state) && options.isSurface?.(view) !== false &&
		(operation !== 'end' || calloutTitleEnd(view.state, view.state.selection.main.head) === null);
}

function dispatchNativeShiftBoundary(view: EditorView, options: StructuredListExtensionOptions, operation: 'home' | 'end', extend: boolean): boolean {
	if (!ownsBoundarySurface(view, options, operation)) return false;
	const mode = classifyCurrentSelectionMode(view.state);
	if (!normalKeyboardSelection(view, mode)) return false;
	const context = boundaryContext(view, options, operation, mode);
	// Match CodeMirror's boundary extension while carrying intent before selection filters run.
	if (context === null) return false;
	const selection = boundarySelection(view, operation === 'end', extend);
	if (selection.eq(view.state.selection)) return true;
	if (extend) view.dispatch({ selection, scrollIntoView: true, userEvent: 'select', annotations: paragraphNavigationAnnotation.of(operation) });
	else dispatchParagraphSelection(view, operation, selection);
	return true;
}

function normalKeyboardSelection(view: EditorView, mode: ContextRuntime['selectionMode']): boolean {
	return (mode === 'caret' || mode === 'continuous') &&
		!view.composing && !requireCompositionState(view.state);
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
