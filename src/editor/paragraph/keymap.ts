import { Prec, type EditorState, type Extension } from '@codemirror/state';
import { keymap, type EditorView, type KeyBinding } from '@codemirror/view';
import { deleteAdjacentCode } from '../code-blocks/operations.js';
import {
	classifyCurrentSelectionMode,
	requireCompositionState,
} from '../runtime/input-state.js';
import {
	createVisualNavigationAdapter,
	requireGoalXStore,
	type VisualNavigationAdapter,
} from '../runtime/navigation-core.js';
import {
	dispatchParagraphEditPlan,
	dispatchParagraphSelection,
} from './edit-plan.js';
import {
	planGapDeletion,
	planHeadingBackspace,
	planParagraphEnter,
	resolveHorizontalSelection,
	resolveLineBoundarySelection,
	resolveVerticalStart,
	resolveVerticalSelection,
	type ParagraphEnterOperation,
} from './operations.js';

export interface ParagraphKeymapOptions {
	readonly isLivePreview: (state: EditorState) => boolean;
	readonly isSurface: (view: EditorView) => boolean;
	readonly visual?: (view: EditorView) => VisualNavigationAdapter;
}

export type ParagraphKeyOperation =
	| ParagraphEnterOperation
	| 'backspace'
	| 'delete'
	| 'left'
	| 'right'
	| 'up'
	| 'down'
	| 'home'
	| 'end';

export function dispatchParagraphOperation(
	view: EditorView,
	operation: ParagraphKeyOperation,
	options: ParagraphKeymapOptions,
): boolean {
	if (!options.isLivePreview(view.state) || !options.isSurface(view)) return false;
	const composing = requireCompositionState(view.state);
	if (view.composing || composing) return false;
	if (classifyCurrentSelectionMode(view.state) !== 'caret') return false;
	if ((operation === 'backspace' || operation === 'delete') && deleteAdjacentCode(view, operation === 'delete')) return true;
	if (operation === 'left' || operation === 'right' || operation === 'home' || operation === 'end') {
		const goalX = requireGoalXStore(view);
		const visual = options.visual?.(view) ?? createVisualNavigationAdapter(view);
		const selection = operation === 'home' || operation === 'end'
			? resolveLineBoundarySelection(view.state, operation === 'end', visual)
			: resolveHorizontalSelection(view.state, operation === 'right', visual);
		if (!selection) return false;
		dispatchParagraphSelection(view, operation, selection);
		goalX.write(null);
		return true;
	}
	if (operation === 'up' || operation === 'down') {
		const start = resolveVerticalStart(view.state);
		if (!start) return false;
		const goalXStore = requireGoalXStore(view);
		const visual = options.visual?.(view) ?? createVisualNavigationAdapter(view);
		const storedGoalX = goalXStore.read() ?? view.state.selection.main.goalColumn ?? null;
		const coordinates = storedGoalX === null
			? visual.coordsAtPos(start)
			: null;
		const goalX = storedGoalX ?? coordinates?.left;
		if (goalX === undefined) return false;
		const selection = resolveVerticalSelection(
			view.state,
			operation === 'down',
			visual,
			goalX,
		);
		if (!selection) return false;
		dispatchParagraphSelection(view, operation, selection);
		goalXStore.write(goalX);
		return true;
	}
	const plan = operation === 'backspace'
		? planHeadingBackspace(view.state) ?? planGapDeletion(view.state, operation)
		: operation === 'delete'
			? planGapDeletion(view.state, operation)
		: planParagraphEnter(view.state, operation);
	if (!plan) return false;
	dispatchParagraphEditPlan(view, plan, plan.operation);
	return true;
}

function binding(
	key: string,
	operation: ParagraphKeyOperation,
	options: ParagraphKeymapOptions,
): KeyBinding {
	return {
		key,
		run: (view) => dispatchParagraphOperation(view, operation, options),
	};
}

export function createParagraphKeymap(options: ParagraphKeymapOptions): Extension {
	return Prec.highest(keymap.of([
		binding('Backspace', 'backspace', options),
		binding('Delete', 'delete', options),
		binding('Enter', 'enter', options),
		binding('Shift-Enter', 'shift-enter', options),
		binding('ArrowLeft', 'left', options),
		binding('ArrowRight', 'right', options),
		binding('ArrowUp', 'up', options),
		binding('ArrowDown', 'down', options),
		binding('Home', 'home', options),
		binding('End', 'end', options),
	]));
}
