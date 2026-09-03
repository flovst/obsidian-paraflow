import { type EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { serializeSelection } from './clipboard.js';
import { buildListContext, buildSelectionContext } from './context.js';
import {
	applyOperationResult,
	createOperationCapabilityRuntime,
	createStateSnapshotId,
	exceptionSinkStateField,
	type OperationCapabilityVerifier,
} from './edit-plan.js';
import { createStructuredListKeymap } from './keymap.js';
import { createStructuredListMouseExtension } from './mouse.js';
import {
	createGoalXStoreExtension,
	createNavigationDestinationResolver,
	createVisualNavigationAdapter,
	goalXStoreFor,
} from './navigation-adapter.js';
import type { ContextRuntime, StructuredListRangeIndex } from './model.js';
import {
	executeRegisteredOperation,
	operationHandlers,
	type ClipboardEventSink,
	type ClipboardSink,
	type GoalXStore,
	type PointerIntent,
	type RuntimeServiceFactory,
	type StructuredListExtensionOptions,
	type StructuredListRuntimeServices,
} from './operations.js';
import { prefixPolicy } from './prefix.js';
import {
	createStructuredListProjection,
	getStructuredListProjectionState,
} from './projection.js';
import {
	classifyCurrentSelectionMode,
	createSelectionProtection,
} from './selection-protection.js';

export { exceptionSinkStateField } from './edit-plan.js';

export interface StructuredListRuntimeServiceFactoryOptions {
	readonly clipboard: ClipboardSink;
}

const emptyRangeIndex: StructuredListRangeIndex = Object.freeze({
	containing: () => null,
	mapEndpoint: (position: number) => position,
	protectedRanges: Object.freeze([]),
});

const fallbackGoalStores = new WeakMap<EditorView, GoalXStore>();

function fallbackGoalStore(view: EditorView): GoalXStore {
	const existing = fallbackGoalStores.get(view);
	if (existing) return existing;
	let value: number | null = null;
	const store: GoalXStore = {
		read: () => value,
		write: (next) => { value = next; },
	};
	fallbackGoalStores.set(view, store);
	return store;
}

function rangeIndexFor(state: EditorState): StructuredListRangeIndex {
	return getStructuredListProjectionState(state)?.rangeIndex ?? emptyRangeIndex;
}

function snapshotRanges(rangeIndex: StructuredListRangeIndex) {
	return Object.freeze(rangeIndex.protectedRanges.map((range) => Object.freeze({ ...range })));
}

function stateBoundVerifier(
	view: EditorView,
	capturedState: EditorState,
	verifier: OperationCapabilityVerifier,
): OperationCapabilityVerifier {
	return {
		verifyAndResolve(...input) {
			if (view.state !== capturedState) return null;
			return verifier.verifyAndResolve(...input);
		},
	};
}

function destinationRuntime(
	view: EditorView,
	scopeFactory: StructuredListRuntimeServices['scopeFactory'],
): ContextRuntime {
	return {
		editIntent: 'none',
		imeComposing: view.composing,
		operation: 'home',
		scopeFactory,
		selectionMode: classifyCurrentSelectionMode(view.state),
		selectionsCount: view.state.selection.ranges.length,
	};
}

function runtimeServicesForView(
	view: EditorView,
	clipboard: ClipboardSink,
): StructuredListRuntimeServices {
	const state = view.state;
	const rangeIndex = rangeIndexFor(state);
	const protectedRanges = snapshotRanges(rangeIndex);
	const stateSnapshotId = createStateSnapshotId();
	const authority = createOperationCapabilityRuntime(
		stateSnapshotId,
		state.doc.length,
		protectedRanges,
	);
	const runtime = destinationRuntime(view, authority.scopeFactory);
	const navigation = {
		capabilities: authority.capabilities,
		goalX: goalXStoreFor(view) ?? fallbackGoalStore(view),
		rangeIndex,
		resolveDestination: createNavigationDestinationResolver({
			rangeIndex,
			runtime,
			state: view.state,
		}),
		visual: createVisualNavigationAdapter(view),
	};
	return {
		navigation,
		result: {
			clipboard,
			validation: { authoritativeProtectedRanges: protectedRanges, stateSnapshotId,
				verifier: stateBoundVerifier(view, state, authority.verifier) },
		},
		scopeFactory: authority.scopeFactory,
		selection: { capabilities: authority.capabilities, clipboard, serialize: serializeSelection },
		structural: { capabilities: authority.capabilities, prefixPolicy },
	};
}

export function createStructuredListRuntimeServiceFactory(
	options: StructuredListRuntimeServiceFactoryOptions,
): RuntimeServiceFactory {
	return {
		forView: (view) => runtimeServicesForView(view, options.clipboard),
	};
}

function pointerRuntime(
	view: EditorView,
	intent: PointerIntent,
	services: StructuredListRuntimeServices,
): ContextRuntime {
	return {
		editIntent: 'none',
		imeComposing: view.composing,
		operation: intent.operation,
		scopeFactory: services.scopeFactory,
		selectionMode: classifyCurrentSelectionMode(view.state),
		selectionsCount: view.state.selection.ranges.length,
	};
}

function createMouseComposition(options: StructuredListExtensionOptions): Extension {
	const runtimes = new WeakMap<EditorView, StructuredListRuntimeServices>();
	return createStructuredListMouseExtension({
		applyResult(view, execution, result) {
			const runtime = runtimes.get(view);
			runtimes.delete(view);
			return runtime ? applyOperationResult(view, execution.intent.operation,
				execution.context.editScope, result, runtime.result) : false;
		},
		createExecution(view, intent) {
			const services = runtimes.get(view);
			if (!services) return null;
			const runtime = pointerRuntime(view, intent, services);
			const context = buildListContext(view.state, intent.documentPosition, runtime);
			if (!context) return null;
			const navigation = {
				...services.navigation,
				resolveDestination: createNavigationDestinationResolver({
					rangeIndex: services.navigation.rangeIndex, runtime, state: view.state,
				}),
			};
			return { context, intent, services: navigation };
		},
		handler: operationHandlers['click-prefix-gutter'],
		isLivePreview: options.isLivePreview,
		services(view) {
			const runtime = options.services.forView(view);
			runtimes.set(view, runtime);
			return runtime.navigation;
		},
	});
}

function selectionRuntime(
	view: EditorView,
	action: 'copy' | 'cut',
	services: StructuredListRuntimeServices,
): ContextRuntime {
	return {
		editIntent: action === 'cut' ? 'cut' : 'none',
		imeComposing: view.composing,
		operation: 'normal-selection',
		scopeFactory: services.scopeFactory,
		selectionMode: classifyCurrentSelectionMode(view.state),
		selectionsCount: view.state.selection.ranges.length,
	};
}

function executeClipboard(
	view: EditorView,
	event: ClipboardEvent,
	action: 'copy' | 'cut',
	options: StructuredListExtensionOptions,
): boolean {
	if (!options.isLivePreview(view.state)) return false;
	const services = options.services.forView(view);
	const runtime = selectionRuntime(view, action, services);
	const selection = view.state.selection;
	const context = buildSelectionContext(view.state, selection, runtime);
	if (!context) return false;
	const main = selection.main;
	const result = executeRegisteredOperation({
		context,
		intent: {
			action,
			family: 'selection',
			mode: 'continuous',
			operation: 'normal-selection',
			selection: { anchor: main.anchor, empty: main.empty, head: main.head },
		},
		services: services.selection,
	});
	if (result.kind === 'pass-through') return false;
	return applyClipboardResult(view, event, context, result, services);
}

function isClipboardEventSink(clipboard: ClipboardSink): clipboard is ClipboardEventSink {
	const candidate: Partial<ClipboardEventSink> = clipboard;
	return typeof candidate.runWithClipboardEvent === 'function';
}

function applyClipboardResult(
	view: EditorView,
	event: ClipboardEvent,
	context: NonNullable<ReturnType<typeof buildSelectionContext>>,
	result: ReturnType<typeof executeRegisteredOperation>,
	services: StructuredListRuntimeServices,
): boolean {
	const apply = () => applyOperationResult(
		view, 'normal-selection', context.editScope, result, services.result,
	);
	if (isClipboardEventSink(services.result.clipboard)) {
		return services.result.clipboard.runWithClipboardEvent(event, apply);
	}
	event.preventDefault();
	return apply();
}

function createClipboardExtension(options: StructuredListExtensionOptions): Extension {
	return EditorView.domEventHandlers({
		copy: (event, view) => executeClipboard(view, event, 'copy', options),
		cut: (event, view) => executeClipboard(view, event, 'cut', options),
	});
}

export function createStructuredListExtension(
	options: StructuredListExtensionOptions,
): Extension {
	return [
		createStructuredListProjection({ isLivePreview: options.isLivePreview }),
		createStructuredListKeymap(options),
		createMouseComposition(options),
		createClipboardExtension(options),
		createSelectionProtection({ isLivePreview: options.isLivePreview }),
		createGoalXStoreExtension(),
		exceptionSinkStateField,
	];
}
