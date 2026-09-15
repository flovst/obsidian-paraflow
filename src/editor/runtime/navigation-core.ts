import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { createInputStateExtension } from './input-state.js';
import { createGapSelectionPresentation } from '../paragraph/selection-presentation.js';

export type VisualAssociation = -1 | 0 | 1;

export interface VisualPosition {
	readonly position: number;
	readonly assoc: VisualAssociation;
}

export interface VisualNavigationAdapter {
	alignGoalOnVisualLine?(
		position: VisualPosition,
		goalX: number,
	): VisualPosition;
	moveByChar(position: VisualPosition, forward: boolean): VisualPosition;
	moveVertically(position: VisualPosition, forward: boolean, goalX: number): VisualPosition;
	visualLineStart(position: VisualPosition): VisualPosition;
	visualLineEnd(position: VisualPosition): VisualPosition;
	coordsAtPos(position: VisualPosition): { readonly left: number; readonly top: number } | null;
	posAtCoords(coords: { readonly x: number; readonly y: number }): VisualPosition | null;
}

export interface GoalXStore {
	read(): number | null;
	write(value: number | null): void;
}

class GoalXPluginValue implements GoalXStore {
	private active = true;
	private value: number | null = null;

	get isActive(): boolean {
		return this.active;
	}

	destroy(): void {
		this.active = false;
		this.value = null;
	}

	read(): number | null {
		return this.active ? this.value : null;
	}

	write(value: number | null): void {
		if (!this.active) throw new Error('Cannot write destroyed goal-X store');
		this.value = value;
	}

	update(update: ViewUpdate): void {
		if (!this.active) return;
		if (update.docChanged || update.transactions.some((transaction) =>
			transaction.isUserEvent('select.pointer') ||
			transaction.isUserEvent('move.character') ||
			(transaction.isUserEvent('select') &&
				transaction.newSelection.main.goalColumn === undefined))) this.value = null;
	}
}

const goalXPlugin = ViewPlugin.define(() => new GoalXPluginValue());

export function createGoalXStoreExtension(): Extension {
	return goalXPlugin;
}

export function goalXStoreFor(view: EditorView): GoalXStore | null {
	const store = view.plugin(goalXPlugin);
	return store?.isActive === true ? store : null;
}

export function requireGoalXStore(view: EditorView): GoalXStore {
	const store = goalXStoreFor(view);
	if (!store) throw new Error('Editor goal-X state is not installed');
	return store;
}

export function createVisualNavigationAdapter(view: EditorView): VisualNavigationAdapter {
	const cursor = (point: VisualPosition, goalX?: number) =>
		EditorSelection.cursor(point.position, point.assoc, undefined, goalX);
	const point = (range: ReturnType<typeof EditorSelection.cursor>): VisualPosition => ({
		assoc: range.assoc,
		position: range.head,
	});
	return {
		alignGoalOnVisualLine(position, goalX) {
			const coordinates = view.coordsAtPos(
				position.position,
				position.assoc < 0 ? -1 : 1,
			);
			if (!coordinates) return position;
			const contentLeft = view.contentDOM.getBoundingClientRect().left;
			const aligned = view.posAtCoords({
				x: contentLeft + goalX,
				y: (coordinates.top + coordinates.bottom) / 2,
			});
			return aligned === null
				? position
				: { assoc: position.assoc, position: aligned };
		},
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

export interface EditorRuntimeExtensionOptions {
	readonly isSelectionPresentationActive?: (view: EditorView) => boolean;
}

export function createEditorRuntimeExtension(
	options: EditorRuntimeExtensionOptions = {},
): Extension {
	return [
		createInputStateExtension(),
		createGoalXStoreExtension(),
		createGapSelectionPresentation({
			isActive: options.isSelectionPresentationActive ?? (() => true),
		}),
	];
}
