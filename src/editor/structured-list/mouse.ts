import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { SourceRange, VisualPosition } from './model.js';
import { goalXStoreFor } from './navigation-adapter.js';
import type {
	ExecutionFor,
	NavigationServices,
	OperationHandler,
	OperationResult,
	PointerIntent,
} from './operations.js';
import { clickPrefixGutter } from './strategies/navigation.js';

export type PointerOwnership =
	| 'paraflow-gutter'
	| 'native-checkbox'
	| 'native-fold'
	| 'drag'
	| 'unsupported';

function eventElement(event: MouseEvent): Element | null {
	const target = event.target;
	if (!target || typeof target !== 'object') return null;
	const document = (target as Node).ownerDocument;
	const elementConstructor = document?.defaultView?.Element;
	return elementConstructor && target instanceof elementConstructor
		? target
		: null;
}

function isNativeCheckbox(element: Element): boolean {
	return element.localName === 'input' && element.getAttribute('type')?.toLowerCase() === 'checkbox';
}

function isNativeFold(element: Element): boolean {
	return element.closest('button[aria-expanded]') !== null;
}

export function classifyPointerOwnership(event: MouseEvent): PointerOwnership {
	if (event.type === 'mousemove') return 'drag';
	const element = eventElement(event);
	if (!element) return 'unsupported';
	if (isNativeCheckbox(element)) return 'native-checkbox';
	if (isNativeFold(element)) return 'native-fold';
	return element.closest('.paraflow-list-marker') ? 'paraflow-gutter' : 'unsupported';
}

export interface StructuredListMouseOptions {
	readonly applyResult: (
		view: EditorView,
		execution: ExecutionFor<'click-prefix-gutter'>,
		result: OperationResult,
	) => boolean;
	readonly createExecution: (
		view: EditorView,
		intent: PointerIntent,
	) => ExecutionFor<'click-prefix-gutter'> | null;
	readonly handler?: OperationHandler<'click-prefix-gutter'>;
	readonly isLivePreview: (state: EditorState) => boolean;
	readonly services: (view: EditorView) => NavigationServices | null;
}

interface PointerGesture {
	readonly button: number;
	readonly startX: number;
	readonly startY: number;
	readonly modified: boolean;
	readonly rangeCount: number;
	readonly startedInsideEditor: boolean;
	dragged: boolean;
	released: boolean;
}

function modified(event: MouseEvent): boolean {
	return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

function moved(gesture: PointerGesture, event: MouseEvent): boolean {
	return event.clientX !== gesture.startX || event.clientY !== gesture.startY;
}

function ordinaryGesture(gesture: PointerGesture | undefined): boolean {
	if (!gesture || !gesture.released || gesture.dragged) return false;
	return gesture.button === 0 && !gesture.modified && gesture.rangeCount === 1;
}

function ordinarySingleClick(gesture: PointerGesture | undefined, event: MouseEvent): boolean {
	return ordinaryGesture(gesture) &&
		event.button === 0 &&
		event.detail === 1 &&
		!modified(event);
}

function rangeAtPoint(
	ranges: readonly SourceRange[],
	point: VisualPosition,
): SourceRange | null {
	return ranges.find((range) => range.from <= point.position && point.position <= range.to) ?? null;
}

function contentRelativeX(view: EditorView, event: MouseEvent): number {
	return event.clientX - view.contentDOM.getBoundingClientRect().left;
}

function intentTarget(
	view: EditorView,
	event: MouseEvent,
	point: VisualPosition,
	range: SourceRange,
	services: NavigationServices,
): PointerIntent['target'] | null {
	if (classifyPointerOwnership(event) === 'paraflow-gutter') return 'marker';
	const contentStart = services.visual.coordsAtPos({ assoc: 1, position: range.to });
	if (!contentStart || contentRelativeX(view, event) >= contentStart.left) return null;
	return 'prefix-gutter';
}

function pointerIntent(
	view: EditorView,
	event: MouseEvent,
	services: NavigationServices,
): PointerIntent | null {
	const point = services.visual.posAtCoords({ x: event.clientX, y: event.clientY });
	if (!point) return null;
	const range = rangeAtPoint(services.rangeIndex.protectedRanges, point);
	if (!range) return null;
	const target = intentTarget(view, event, point, range, services);
	return target ? {
		documentPosition: point.position,
		drag: false,
		family: 'pointer',
		operation: 'click-prefix-gutter',
		rangeCount: 1,
		target,
	} : null;
}

function executePointerClick(
	view: EditorView,
	event: MouseEvent,
	options: StructuredListMouseOptions,
): boolean {
	const services = options.services(view);
	if (!services) return false;
	const intent = pointerIntent(view, event, services);
	if (!intent) return false;
	const execution = options.createExecution(view, intent);
	if (!execution) return false;
	const result = (options.handler ?? clickPrefixGutter)(execution);
	return options.applyResult(view, execution, result);
}

function supportedPointerTarget(
	view: EditorView,
	event: MouseEvent,
	ownership: PointerOwnership,
): boolean {
	if (ownership === 'paraflow-gutter') return true;
	const element = eventElement(event);
	return element !== null &&
		(element === view.contentDOM || view.contentDOM.contains(element));
}

function eventInsideEditor(view: EditorView, event: MouseEvent): boolean {
	const element = eventElement(event);
	return element !== null &&
		(element === view.contentDOM || view.contentDOM.contains(element));
}

function clearGoalForEditorClick(
	view: EditorView,
	event: MouseEvent,
	gesture: PointerGesture,
): void {
	if (!gesture.startedInsideEditor && !eventInsideEditor(view, event)) return;
	goalXStoreFor(view)?.write(null);
}

export interface StructuredListClickAdapter {
	mousedown(view: EditorView, event: MouseEvent): boolean;
	mousemove(view: EditorView, event: MouseEvent): boolean;
	mouseup(view: EditorView, event: MouseEvent): boolean;
	click(view: EditorView, event: MouseEvent): boolean;
}

export function createStructuredListClickAdapter(
	options: StructuredListMouseOptions,
): StructuredListClickAdapter {
	const gestures = new WeakMap<EditorView, PointerGesture>();
	return {
		mousedown(view, event) {
			gestures.set(view, {
				button: event.button,
				dragged: false,
				modified: modified(event),
				rangeCount: view.state.selection.ranges.length,
				released: false,
				startX: event.clientX,
				startY: event.clientY,
				startedInsideEditor: eventInsideEditor(view, event),
			});
			return false;
		},
		mousemove(view, event) {
			const gesture = gestures.get(view);
			if (gesture && moved(gesture, event)) gesture.dragged = true;
			return false;
		},
		mouseup(view, event) {
			const gesture = gestures.get(view);
			if (gesture) {
				if (moved(gesture, event)) gesture.dragged = true;
				gesture.released = true;
			}
			return false;
		},
		click(view, event) {
			const gesture = gestures.get(view);
			gestures.delete(view);
			if (!options.isLivePreview(view.state)) return false;
			if (!gesture || !ordinarySingleClick(gesture, event)) return false;
			clearGoalForEditorClick(view, event, gesture);
			const ownership = classifyPointerOwnership(event);
			if (ownership === 'native-checkbox' || ownership === 'native-fold') return false;
			if (!supportedPointerTarget(view, event, ownership)) return false;
			return executePointerClick(view, event, options);
		},
	};
}

export function createStructuredListMouseExtension(
	options: StructuredListMouseOptions,
): Extension {
	const adapter = createStructuredListClickAdapter(options);
	return EditorView.domEventHandlers({
		click: (event, view) => adapter.click(view, event),
		mousedown: (event, view) => adapter.mousedown(view, event),
		mousemove: (event, view) => adapter.mousemove(view, event),
		mouseup: (event, view) => adapter.mouseup(view, event),
	});
}
