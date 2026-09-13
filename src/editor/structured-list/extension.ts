import {
	StateEffect,
	StateField,
	type EditorState,
	type Extension,
	type StateEffectType,
} from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { classifyCurrentSelectionMode } from '../runtime/input-state.js';
import {
	createVisualNavigationAdapter,
	requireGoalXStore,
} from '../runtime/navigation-core.js';
import { serializeSelection } from './clipboard.js';
import { buildListContext, buildSelectionContext } from './context.js';
import {
	applyOperationResult,
	exceptionSinkStateField,
} from './edit-plan.js';
import { createStructuredListKeymap } from './keymap.js';
import { createStructuredListMouseExtension } from './mouse.js';
import {
	createNavigationDestinationResolver,
} from './navigation-adapter.js';
import type { ContextRuntime, StructuredListRangeIndex } from './model.js';
import {
	executeRegisteredOperation,
	operationHandlers,
	type ClipboardEventSink,
	type ClipboardSink,
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
import { createSelectionProtection } from './selection-protection.js';

export { exceptionSinkStateField } from './edit-plan.js';

const STRUCTURED_LIST_ACTIVE_CLASS = 'paraflow-structured-list-active';

function isActive(view: EditorView, options: StructuredListExtensionOptions): boolean {
	return options.isLivePreview(view.state) && (options.isSurface?.(view) ?? true);
}

interface StateViewCounts {
	readonly active: number;
	readonly total: number;
}

function addStateView(
	stateViews: Map<EditorState, StateViewCounts>,
	state: EditorState,
	active: boolean,
): void {
	const counts = stateViews.get(state) ?? { active: 0, total: 0 };
	stateViews.set(state, {
		active: counts.active + (active ? 1 : 0),
		total: counts.total + 1,
	});
}

function removeStateView(
	stateViews: Map<EditorState, StateViewCounts>,
	state: EditorState,
	active: boolean,
): void {
	const counts = stateViews.get(state);
	if (!counts) return;
	if (counts.total === 1) {
		stateViews.delete(state);
		return;
	}
	stateViews.set(state, {
		active: counts.active - (active ? 1 : 0),
		total: counts.total - 1,
	});
}

function createActivationExtension(
	options: StructuredListExtensionOptions,
	stateViews: Map<EditorState, StateViewCounts>,
	identityField: StateField<object | null>,
	setIdentity: StateEffectType<object>,
	activeIdentities: WeakSet<object>,
): Extension {
	return [
		EditorView.editorAttributes.of((view) => ({
			class: isActive(view, options) ? STRUCTURED_LIST_ACTIVE_CLASS : '',
		})),
		ViewPlugin.fromClass(class {
			private active: boolean;
			private destroyed = false;
			private readonly identity = {};
			private state: EditorState;

			constructor(private readonly view: EditorView) {
				this.active = isActive(view, options);
				this.state = view.state;
				addStateView(stateViews, this.state, this.active);
				this.syncIdentityActivity();
				// CodeMirror forbids dispatch during ViewPlugin construction.
				void Promise.resolve().then(() => this.installIdentity());
			}

			destroy(): void {
				this.destroyed = true;
				removeStateView(stateViews, this.state, this.active);
				activeIdentities.delete(this.identity);
			}

			update(update: ViewUpdate): void {
				removeStateView(stateViews, this.state, this.active);
				this.active = isActive(this.view, options);
				this.state = update.state;
				addStateView(stateViews, this.state, this.active);
				this.syncIdentityActivity();
			}

			private installIdentity(): void {
				if (this.destroyed || this.view.state.field(identityField, false) === undefined) return;
				this.view.dispatch({ effects: setIdentity.of(this.identity) });
			}

			private syncIdentityActivity(): void {
				if (this.active) activeIdentities.add(this.identity);
				else activeIdentities.delete(this.identity);
			}
		}),
	];
}

export interface StructuredListRuntimeServiceFactoryOptions {
	readonly clipboard: ClipboardSink;
}

function rangeIndexFor(state: EditorState): StructuredListRangeIndex {
	const projection = getStructuredListProjectionState(state);
	if (!projection) throw new Error('Structured-list projection state is not installed');
	return projection.rangeIndex;
}

function snapshotRanges(rangeIndex: StructuredListRangeIndex) {
	return Object.freeze(rangeIndex.protectedRanges.map((range) => Object.freeze({ ...range })));
}

function destinationRuntime(
	view: EditorView,
): ContextRuntime {
	return {
		editIntent: 'none',
		imeComposing: view.composing,
		operation: 'home',
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
	const runtime = destinationRuntime(view);
	const goalX = requireGoalXStore(view);
	const navigation = {
		goalX,
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
			validation: { authoritativeProtectedRanges: protectedRanges },
		},
		selection: { clipboard, serialize: serializeSelection },
		structural: { prefixPolicy },
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
	const currentSelectionMode = classifyCurrentSelectionMode(view.state);
	const selectionMode = currentSelectionMode === 'unknown' &&
		view.state.selection.ranges.length === 1 && view.state.selection.main.empty
		// The click adapter has already proved a fresh unmodified single-range gesture.
		? 'caret'
		: currentSelectionMode;
	return {
		editIntent: 'none',
		imeComposing: view.composing,
		operation: intent.operation,
		selectionMode,
		selectionsCount: view.state.selection.ranges.length,
	};
}

function createMouseComposition(options: StructuredListExtensionOptions): Extension {
	const runtimes = new WeakMap<EditorView, StructuredListRuntimeServices>();
	return createStructuredListMouseExtension({
		applyResult(view, execution, result) {
			const runtime = runtimes.get(view);
			return runtime ? applyOperationResult(view, execution.intent.operation,
				execution.context.editScope, result, runtime.result) : false;
		},
		clearTransientState(view) {
			runtimes.delete(view);
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
		isActive: (view) => isActive(view, options),
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
	if (!isActive(view, options)) return false;
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
	const setIdentity = StateEffect.define<object>();
	const identityField = StateField.define<object | null>({
		create: () => null,
		update(identity, transaction) {
			for (const effect of transaction.effects) {
				if (effect.is(setIdentity)) return effect.value;
			}
			return identity;
		},
	});
	const activeIdentities = new WeakSet<object>();
	const stateViews = new Map<EditorState, StateViewCounts>();
	const isActiveState = (state: EditorState): boolean => {
		const counts = stateViews.get(state);
		if (!counts || counts.active !== counts.total) return false;
		const identity = state.field(identityField, false);
		return identity !== null && identity !== undefined &&
			options.isLivePreview(state) && activeIdentities.has(identity);
	};
	return [
		identityField,
		createActivationExtension(
			options,
			stateViews,
			identityField,
			setIdentity,
			activeIdentities,
		),
		createStructuredListProjection({
			isActive: (view) => isActive(view, options),
			isLivePreview: options.isLivePreview,
		}),
		createStructuredListKeymap(options),
		createMouseComposition(options),
		createClipboardExtension(options),
		createSelectionProtection({ isLivePreview: isActiveState }),
		exceptionSinkStateField,
	];
}
