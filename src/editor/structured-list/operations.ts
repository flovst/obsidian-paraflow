import type { EditorSelection, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type {
	GoalXStore,
	VisualNavigationAdapter,
	VisualPosition,
} from '../runtime/navigation-core.js';
import type {
	EditPlan,
	EditValidationInput,
} from './edit-plan.js';
import type {
	ListContext,
	NavigationContext,
	NavigationDestination,
	PrefixPolicy,
	SelectionContext,
	SelectionSnapshot,
	StructuredListRangeIndex,
} from './model.js';
import {
	backspaceEmptyNested,
	backspaceEmptyTopLevel,
	backspaceNestedContentStart,
	backspaceTopLevelContentStart,
} from './strategies/backspace.js';
import { backspaceDeleteInsideContent } from './strategies/delete.js';
import {
	enterEmptyNested,
	enterEmptyTopLevel,
	enterNonEmpty,
	enterTaskNonEmpty,
	shiftEnter,
} from './strategies/enter.js';
import { shiftTab, tab } from './strategies/indent.js';
import {
	clickPrefixGutter,
	end,
	home,
	leftAtContentStart,
	right,
	upDown,
} from './strategies/navigation.js';
import { normalSelection } from './strategies/selection.js';

export type ContractOperationId =
	| 'backspace-delete-inside-content'
	| 'backspace-nested-content-start'
	| 'backspace-top-level-content-start'
	| 'backspace-empty-nested'
	| 'backspace-empty-top-level'
	| 'enter-non-empty'
	| 'enter-task-non-empty'
	| 'enter-empty-nested'
	| 'enter-empty-top-level'
	| 'shift-enter'
	| 'tab'
	| 'shift-tab'
	| 'home'
	| 'left-content-start'
	| 'right'
	| 'end'
	| 'up-down'
	| 'click-prefix-gutter'
	| 'click-task-checkbox'
	| 'normal-selection';

export type NativeOwnedOperationId = 'click-task-checkbox';
export type HandledOperationId = Exclude<ContractOperationId, NativeOwnedOperationId>;
export type StructuralOperationId = Exclude<
	HandledOperationId,
	| 'home'
	| 'left-content-start'
	| 'right'
	| 'end'
	| 'up-down'
	| 'click-prefix-gutter'
	| 'normal-selection'
>;
export type NavigationOperationId =
	| 'home'
	| 'left-content-start'
	| 'right'
	| 'end'
	| 'up-down';

export const contractOperationIds = [
	'backspace-delete-inside-content',
	'backspace-nested-content-start',
	'backspace-top-level-content-start',
	'backspace-empty-nested',
	'backspace-empty-top-level',
	'enter-non-empty',
	'enter-task-non-empty',
	'enter-empty-nested',
	'enter-empty-top-level',
	'shift-enter',
	'tab',
	'shift-tab',
	'home',
	'left-content-start',
	'right',
	'end',
	'up-down',
	'click-prefix-gutter',
	'click-task-checkbox',
	'normal-selection',
] as const satisfies readonly ContractOperationId[];

export const handledOperationIds: readonly HandledOperationId[] = contractOperationIds.filter(
	(operation): operation is HandledOperationId => operation !== 'click-task-checkbox',
);

export interface StructuralIntent<K extends StructuralOperationId> {
	readonly family: 'structural';
	readonly operation: K;
	readonly direction: 'backward' | 'forward' | null;
}

export interface NavigationIntent<K extends NavigationOperationId> {
	readonly family: 'navigation';
	readonly operation: K;
	readonly direction: 'up' | 'down' | 'backward' | 'forward' | null;
	readonly extend: boolean;
}

export interface PointerIntent {
	readonly family: 'pointer';
	readonly operation: 'click-prefix-gutter';
	readonly documentPosition: number;
	readonly target: 'marker' | 'prefix-gutter';
	readonly drag: false;
	readonly rangeCount: 1;
}

export interface NormalSelectionIntent {
	readonly family: 'selection';
	readonly operation: 'normal-selection';
	readonly action: 'map' | 'copy' | 'cut';
	readonly mode: 'continuous';
	readonly selection: SelectionSnapshot;
}

export interface StructuralServices {
	readonly prefixPolicy: PrefixPolicy;
}

export interface NavigationServices {
	readonly visual: VisualNavigationAdapter;
	readonly goalX: GoalXStore;
	readonly rangeIndex: StructuredListRangeIndex;
	resolveDestination(rawPosition: VisualPosition, bias: -1 | 1): NavigationDestination | null;
}

export interface ClipboardSink {
	writeText(text: string): void;
}

export interface ClipboardEventSink extends ClipboardSink {
	runWithClipboardEvent<T>(event: ClipboardEvent, write: () => T): T;
}

export interface SelectionServices {
	serialize(context: SelectionContext): string;
	readonly clipboard: ClipboardSink;
}

export interface OperationResultServices {
	readonly validation: Omit<EditValidationInput, 'expectedOperation' | 'expectedScope'>;
	readonly clipboard: ClipboardSink;
}

export interface StructuredListRuntimeServices {
	readonly structural: StructuralServices;
	readonly navigation: NavigationServices;
	readonly selection: SelectionServices;
	readonly result: OperationResultServices;
}

export interface RuntimeServiceFactory {
	forView(view: EditorView): StructuredListRuntimeServices;
}

export interface StructuredListExtensionOptions {
	readonly isLivePreview: (state: EditorState) => boolean;
	readonly isSurface?: (view: EditorView) => boolean;
	readonly services: RuntimeServiceFactory;
}

type StructuralExecution<K extends StructuralOperationId> = {
	readonly intent: StructuralIntent<K>;
	readonly context: ListContext;
	readonly services: StructuralServices;
};

type NavigationExecution<K extends NavigationOperationId> = {
	readonly intent: NavigationIntent<K>;
	readonly context: NavigationContext;
	readonly services: NavigationServices;
};

export type ExecutionFor<K extends HandledOperationId> =
	K extends StructuralOperationId
		? StructuralExecution<K>
		: K extends NavigationOperationId
			? NavigationExecution<K>
			: K extends 'click-prefix-gutter'
				? {
						readonly intent: PointerIntent;
						readonly context: ListContext;
						readonly services: NavigationServices;
					}
				: {
						readonly intent: NormalSelectionIntent;
						readonly context: SelectionContext;
						readonly services: SelectionServices;
					};

export type OperationResult =
	| { readonly kind: 'pass-through' }
	| { readonly kind: 'selection'; readonly selection: EditorSelection }
	| { readonly kind: 'edit'; readonly plan: EditPlan }
	| {
			readonly kind: 'clipboard';
			readonly text: string;
			readonly edit: EditPlan | null;
	  };

export type OperationHandler<K extends HandledOperationId> = (
	execution: ExecutionFor<K>,
) => OperationResult;
export type OperationHandlers = {
	readonly [K in HandledOperationId]: OperationHandler<K>;
};

type StructuralOperationHandlers = {
	readonly [K in StructuralOperationId]: (
		execution: StructuralExecution<K>,
	) => OperationResult;
};
type NavigationOperationHandlers = {
	readonly [K in NavigationOperationId]: (
		execution: NavigationExecution<K>,
	) => OperationResult;
};

const structuralOperationHandlers: StructuralOperationHandlers = {
	'backspace-delete-inside-content': backspaceDeleteInsideContent,
	'backspace-empty-nested': backspaceEmptyNested,
	'backspace-empty-top-level': backspaceEmptyTopLevel,
	'backspace-nested-content-start': backspaceNestedContentStart,
	'backspace-top-level-content-start': backspaceTopLevelContentStart,
	'enter-empty-nested': enterEmptyNested,
	'enter-empty-top-level': enterEmptyTopLevel,
	'enter-non-empty': enterNonEmpty,
	'enter-task-non-empty': enterTaskNonEmpty,
	'shift-enter': shiftEnter,
	'shift-tab': shiftTab,
	tab,
};

const navigationOperationHandlers: NavigationOperationHandlers = {
	end,
	home,
	'left-content-start': leftAtContentStart,
	right,
	'up-down': upDown,
};

export const operationHandlers: OperationHandlers = {
	...structuralOperationHandlers,
	...navigationOperationHandlers,
	'click-prefix-gutter': clickPrefixGutter,
	'normal-selection': normalSelection,
};

function executeStructural<K extends StructuralOperationId>(
	execution: StructuralExecution<K>,
): OperationResult {
	return structuralOperationHandlers[execution.intent.operation](execution);
}

function executeNavigation<K extends NavigationOperationId>(
	execution: NavigationExecution<K>,
): OperationResult {
	return navigationOperationHandlers[execution.intent.operation](execution);
}

type RegisteredExecution =
	| StructuralExecution<StructuralOperationId>
	| NavigationExecution<NavigationOperationId>
	| ExecutionFor<'click-prefix-gutter'>
	| ExecutionFor<'normal-selection'>;

function isStructuralExecution(
	execution: RegisteredExecution,
): execution is StructuralExecution<StructuralOperationId> {
	return execution.intent.family === 'structural';
}

function isNavigationExecution(
	execution: RegisteredExecution,
): execution is NavigationExecution<NavigationOperationId> {
	return execution.intent.family === 'navigation';
}

function isPointerExecution(
	execution: RegisteredExecution,
): execution is ExecutionFor<'click-prefix-gutter'> {
	return execution.intent.family === 'pointer';
}

export function executeRegisteredOperation<K extends StructuralOperationId>(
	execution: StructuralExecution<K>,
): OperationResult;
export function executeRegisteredOperation<K extends NavigationOperationId>(
	execution: NavigationExecution<K>,
): OperationResult;
export function executeRegisteredOperation(
	execution: ExecutionFor<'click-prefix-gutter'>,
): OperationResult;
export function executeRegisteredOperation(
	execution: ExecutionFor<'normal-selection'>,
): OperationResult;
export function executeRegisteredOperation(execution: RegisteredExecution): OperationResult {
	if (isStructuralExecution(execution)) return executeStructural(execution);
	if (isNavigationExecution(execution)) return executeNavigation(execution);
	if (isPointerExecution(execution)) return operationHandlers['click-prefix-gutter'](execution);
	return operationHandlers['normal-selection'](execution);
}
