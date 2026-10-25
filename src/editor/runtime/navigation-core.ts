import { EditorSelection, Facet, Prec, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { createInputStateExtension } from './input-state.js';
import { createSelectionPresentationSessionExtension } from './selection-session.js';
import { createGapSelectionPresentation } from '../paragraph/selection-presentation.js';
import { createVirtualTailExtension } from './virtual-tail.js';
import { containerBodyLine } from './container-body-boundaries.js';
import { renderedSourceClickPosition } from './rendered-source-click.js';
import { getParagraphProjectionState } from '../paragraph/projection.js';
import { getStructuredListProjectionState } from '../structured-list/projection.js';

export type VisualAssociation = -1 | 0 | 1;

export interface VisualPosition {
	readonly position: number;
	readonly assoc: VisualAssociation;
}

/** Rendered source hints expose character hits through the same navigation path as ordinary text. */
export const renderedSourceHit = Facet.define<
	(view: EditorView, coordinates: { x: number; y: number }) => VisualPosition | null>();

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

export function moveToRenderedSource(view: EditorView, forward: boolean): boolean {
	const current = view.state.selection.main;
	if (!current.empty || view.state.selection.ranges.length !== 1 || view.composing) return false;
	const visual = createVisualNavigationAdapter(view);
	const start = { position: current.head, assoc: current.assoc };
	const store = requireGoalXStore(view);
	const goalX = store.read() ?? current.goalColumn ?? visual.coordsAtPos(start)?.left;
	if (goalX === undefined) return false;
	const native = view.moveVertically(EditorSelection.cursor(current.head, current.assoc, undefined, goalX), forward);
	const coordinates = view.coordsAtPos(native.head, native.assoc < 0 ? -1 : 1);
	if (!coordinates) return false;
	const hit = resolveRenderedHit(view, { x: view.contentDOM.getBoundingClientRect().left + goalX,
		y: (coordinates.top + coordinates.bottom) / 2 });
	if (!hit || hit.position === current.head) return false;
	view.dispatch({ selection: EditorSelection.cursor(hit.position, hit.assoc, undefined, goalX), userEvent: 'select', scrollIntoView: true });
	store.write(goalX);
	return true;
}

export function createRenderedSourceNavigation(): Extension {
	return [createGoalXStoreExtension(), Prec.highest(keymap.of([
		{ key: 'ArrowUp', run: view => moveToRenderedSource(view, false) },
		{ key: 'ArrowDown', run: view => moveToRenderedSource(view, true) },
	]))];
}

function resolveRenderedHit(view: EditorView, coordinates: { x: number; y: number }): VisualPosition | null {
	for (const resolve of view.state.facet(renderedSourceHit)) {
		const hit = resolve(view, coordinates);
		if (hit) return hit;
	}
	return null;
}

export function createVisualNavigationAdapter(view: EditorView): VisualNavigationAdapter {
	const renderedHit = (coordinates: { x: number; y: number }): VisualPosition | null => resolveRenderedHit(view, coordinates);
	const emptyBodyAnchor = (position: number): number | null =>
		containerBodyLine(view.state, position)?.emptyAnchor ??
		(getParagraphProjectionState(view.state)?.rangeIndex.editableAnchors.includes(position) ? position : null);
	const mountedEmptyBody = (position: number): number | null => {
		const anchor = emptyBodyAnchor(position);
		if (anchor === null) return null;
		const line = view.state.doc.lineAt(anchor), node = view.domAtPos(anchor).node;
		const row = (node.nodeType === 1 ? node as Element : node.parentElement)?.closest('.cm-line');
		return row?.closest('.cm-editor') === view.dom && view.posAtDOM(row) === line.from && row.getBoundingClientRect().height > 0 ? anchor : null;
	};
	const visibleGeometry = (position: VisualPosition): { position: VisualPosition; coordinates: ReturnType<EditorView['coordsAtPos']> } => {
		const side = position.assoc < 0 ? -1 : 1;
		const coordinates = view.coordsAtPos(position.position, side);
		if (coordinates && coordinates.top === coordinates.bottom) {
			// A folded block carrier shares its offset with the visible text before it.
			const oppositeSide = side === 1 ? -1 : 1;
			const opposite = view.coordsAtPos(position.position, oppositeSide);
			if (opposite && opposite.top < opposite.bottom) {
				return { position: { ...position, assoc: oppositeSide }, coordinates: opposite };
			}
		}
		return { position, coordinates };
	};
	const cursor = (point: VisualPosition, goalX?: number) =>
		EditorSelection.cursor(point.position, point.assoc, undefined, goalX);
	const point = (range: ReturnType<typeof EditorSelection.cursor>): VisualPosition => ({
		assoc: range.assoc,
		position: range.head,
	});
	return {
		alignGoalOnVisualLine(position, goalX) {
			if (mountedEmptyBody(position.position) === position.position) return position;
			const body = containerBodyLine(view.state, position.position);
			if (body && body.emptyAnchor !== null) {
				return { ...position, position: body.emptyAnchor };
			}
			const coordinates = view.coordsAtPos(
				position.position,
				position.assoc < 0 ? -1 : 1,
			);
			if (!coordinates) return position;
			const contentLeft = view.contentDOM.getBoundingClientRect().left;
			const targetY = (coordinates.top + coordinates.bottom) / 2;
			const sourceHit = renderedHit({ x: contentLeft + goalX, y: targetY });
			if (sourceHit) return sourceHit;
			// The target row is already known; a block height lookup can select a neighbouring gap.
			const bodyHit = body ? renderedSourceClickPosition({ clientX: contentLeft + goalX, clientY: targetY }, view.contentDOM, (node, offset) => {
				const element = node.nodeType === 1 ? node as Element : node.parentElement;
				if (element?.closest('.cm-editor') !== view.dom || element.closest('[contenteditable="false"]')) return null;
				const at = view.posAtDOM(node, offset);
				return body.bodyFrom <= at && at <= body.to ? at : null;
			}) : null;
			const hit = bodyHit ?? view.posAtCoords({
				x: contentLeft + goalX,
				y: targetY,
			});
			const aligned = hit !== null && body && body.from <= hit && hit < body.bodyFrom ? body.bodyFrom : hit;
			if (aligned === null || aligned === position.position) return position;
			const before = view.coordsAtPos(aligned, -1);
			const after = view.coordsAtPos(aligned, 1);
			const beforeOnRow = before !== null && before.top <= targetY && targetY <= before.bottom;
			const afterOnRow = after !== null && after.top <= targetY && targetY <= after.bottom;
			return {
				assoc: beforeOnRow === afterOnRow ? position.assoc : beforeOnRow ? -1 : 1,
				position: aligned,
			};
		},
		coordsAtPos(position) {
			const { coordinates } = visibleGeometry(position);
			return coordinates ? {
				left: coordinates.left - view.contentDOM.getBoundingClientRect().left,
				top: coordinates.top,
			} : null;
		},
		moveByChar(position, forward) {
			return point(view.moveByChar(cursor(position), forward));
		},
		moveVertically(position, forward, goalX) {
			const origin = visibleGeometry(position);
			let candidate = point(view.moveVertically(cursor(origin.position, goalX), forward));
			const direction = forward ? 1 : -1;
			const lastLine = view.state.doc.lineAt(candidate.position).number;
			// Native atomic skipping may cross an empty body's prefix and its preceding gap together.
			for (let number = view.state.doc.lineAt(position.position).number + direction;
				forward ? number <= lastLine : number >= lastLine; number += direction) {
				const anchor = mountedEmptyBody(view.state.doc.line(number).to);
				if (anchor !== null && (forward ? anchor < candidate.position : anchor > candidate.position)) return { position: anchor, assoc: direction };
			}
			// Adjacent gaps share the editable endpoint of an empty body.
			if (mountedEmptyBody(candidate.position) === candidate.position ||
				containerBodyLine(view.state, candidate.position)?.emptyAnchor === candidate.position) return candidate;
			let coordinates = view.coordsAtPos(candidate.position, candidate.assoc < 0 ? -1 : 1);
			let crossedHiddenCarrier = false;
			const atomicBoundary = (point: VisualPosition) => {
				let touches = false, inside = false, starts = false, ends = false;
				for (const read of view.state.facet(EditorView.atomicRanges)) {
					read(view).between(point.position, point.position, (from, to) => {
						if (from === to) return;
						touches = true;
						starts ||= from === point.position;
						ends ||= to === point.position;
						if (from < point.position && point.position < to) inside = true;
					});
				}
				const body = containerBodyLine(view.state, point.position);
				const hiddenPrefix = (body !== null && point.position < body.bodyFrom) ||
					getStructuredListProjectionState(view.state)?.rangeIndex.protectedRanges.some(range =>
						range.from <= point.position && point.position < range.to);
				return { touches, inside: inside || hiddenPrefix || (starts && ends), side: ends ? 1 as const : -1 as const };
			};
			// Prefix widgets may expose their block box instead of the adjacent text row.
			for (;;) {
				const boundary = atomicBoundary(candidate);
				const endpoint = boundary.touches && !boundary.inside;
				if (endpoint) {
					candidate = {...candidate, assoc: boundary.side};
					coordinates = view.coordsAtPos(candidate.position, boundary.side);
					crossedHiddenCarrier = true;
					// The prefix's widget can occupy a row before its first editable glyph.
					if (coordinates && coordinates.top < coordinates.bottom && (!origin.coordinates ||
						(forward ? coordinates.top >= origin.coordinates.bottom : coordinates.bottom <= origin.coordinates.top))) break;
				}
				if (!endpoint && (!coordinates || (coordinates.top < coordinates.bottom && !boundary.inside))) break;
				const next = point(view.moveByChar(cursor(candidate), forward));
				if (next.position === candidate.position) break;
				candidate = next;
				coordinates = view.coordsAtPos(candidate.position, candidate.assoc < 0 ? -1 : 1);
				crossedHiddenCarrier = true;
			}
			if (crossedHiddenCarrier && coordinates && coordinates.top < coordinates.bottom) {
				return this.alignGoalOnVisualLine!(candidate, goalX);
			}
			return coordinates ? renderedHit({ x: view.contentDOM.getBoundingClientRect().left + goalX,
				y: (coordinates.top + coordinates.bottom) / 2 }) ?? candidate : candidate;
		},
		posAtCoords(coordinates) {
			const sourceHit = renderedHit(coordinates);
			if (sourceHit) return sourceHit;
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
	readonly isSelectionPresentationStateActive?: (state: EditorState) => boolean;
}

export function createEditorRuntimeExtension(
	options: EditorRuntimeExtensionOptions = {},
): Extension {
	return [
		createInputStateExtension(),
		createGoalXStoreExtension(),
		createVirtualTailExtension({isActive:options.isSelectionPresentationActive??(()=>true)}),
		createSelectionPresentationSessionExtension({
			isActiveState: options.isSelectionPresentationStateActive,
			isActiveView: options.isSelectionPresentationActive,
		}),
		createGapSelectionPresentation({
			isActive: options.isSelectionPresentationActive ?? (() => true),
		}),
	];
}
