import { WidgetType, type EditorView, type Rect } from '@codemirror/view';
import type { PrefixPolicy, ProjectionListContext } from './model.js';

export type StructuredListMarkerShape = 'disc' | 'ring' | 'square';

export interface StructuredListMarker {
	readonly depth: number;
	readonly kind: 'ordered' | 'task' | 'unordered';
	readonly label: string | null;
	readonly shape: StructuredListMarkerShape;
}

const BASE_CLASS = 'paraflow-list-marker';
const LABEL_CLASS = `${BASE_CLASS}-label`;
const SHAPES: readonly StructuredListMarkerShape[] = ['disc', 'ring', 'square'];
const FORWARDED_MOUSE_EVENTS = new Set(['click', 'mousedown', 'mousemove', 'mouseup']);
function markerShape(depth: number): StructuredListMarkerShape {
	return SHAPES[Math.min(Math.max(0, depth), SHAPES.length - 1)] ?? 'disc';
}

function renderedOrderedLabel(
	context: ProjectionListContext,
	policy: PrefixPolicy,
): string | null {
	const orderedValue = context.orderedSequence?.renderedValue;
	if (orderedValue === undefined) return null;
	const rendered = policy.renderSameLevel(context.block.prefix, { orderedValue });
	return /^\S+/u.exec(rendered)?.[0] ?? null;
}

export function markerForProjection(
	context: ProjectionListContext,
	policy: PrefixPolicy,
): StructuredListMarker {
	const prefix = context.block.prefix;
	return Object.freeze({
		depth: context.depth,
		kind: prefix.kind,
		label: renderedOrderedLabel(context, policy),
		shape: markerShape(context.depth),
	});
}

function markerClasses(marker: StructuredListMarker): string {
	const orderedClass = marker.label === null ? 'unordered' : 'ordered';
	const classes = [
		BASE_CLASS,
		`${BASE_CLASS}--${marker.kind}`,
		`${BASE_CLASS}--${orderedClass}`,
	];
	if (marker.label === null) classes.push(`${BASE_CLASS}--${marker.shape}`);
	return [...new Set(classes)].join(' ');
}

function updateMarkerLabel(dom: HTMLElement, label: string | null): void {
	if (label === null) {
		dom.replaceChildren();
		return;
	}
	const current = dom.firstElementChild;
	const labelDom = dom.childNodes.length === 1 &&
		current?.tagName === 'BDI' &&
		current.classList.contains(LABEL_CLASS)
		? current as HTMLElement
		: dom.ownerDocument.createElement('bdi');
	labelDom.className = LABEL_CLASS;
	labelDom.setAttribute('dir', 'ltr');
	labelDom.textContent = label;
	if (labelDom !== current || dom.childNodes.length !== 1) dom.replaceChildren(labelDom);
}

function updateOwnedMarker(dom: HTMLElement, marker: StructuredListMarker): void {
	dom.className = markerClasses(marker);
	updateMarkerLabel(dom, marker.label);
	dom.setAttribute('aria-hidden', 'true');
	dom.setAttribute('contenteditable', 'false');
	dom.setAttribute('draggable', 'false');
}

function sameMarker(left: StructuredListMarker, right: StructuredListMarker): boolean {
	return left.depth === right.depth &&
		left.kind === right.kind &&
		left.label === right.label &&
		left.shape === right.shape;
}

export class StructuredListMarkerWidget extends WidgetType {
	constructor(readonly marker: StructuredListMarker) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof StructuredListMarkerWidget && sameMarker(this.marker, other.marker);
	}

	ignoreEvent(event: Event): boolean {
		return !FORWARDED_MOUSE_EVENTS.has(event.type);
	}

	toDOM(_view: EditorView): HTMLElement {
		const dom = document.createElementNS('http://www.w3.org/1999/xhtml', 'span');
		updateOwnedMarker(dom, this.marker);
		return dom;
	}

	updateDOM(dom: HTMLElement, _view: EditorView): boolean {
		if (!dom.classList.contains(BASE_CLASS)) return false;
		updateOwnedMarker(dom, this.marker);
		return true;
	}
}

export class TaskPrefixWidget extends WidgetType {
	constructor(
		readonly marker: StructuredListMarker,
		readonly markerSeparator: string,
		readonly checked: boolean,
		readonly contentSeparator: string,
	) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof TaskPrefixWidget &&
			sameMarker(other.marker, this.marker) &&
			other.markerSeparator === this.markerSeparator &&
			other.checked === this.checked &&
			other.contentSeparator === this.contentSeparator;
	}

	ignoreEvent(event: Event): boolean {
		return !FORWARDED_MOUSE_EVENTS.has(event.type);
	}

	coordsAt(dom: HTMLElement, pos: number, side: number): Rect | null {
		const prefixRects = dom.getClientRects();
		const metric = dom.querySelector<HTMLElement>('.paraflow-task-caret-metric');
		const metricRect = metric?.getBoundingClientRect();
		if (prefixRects.length === 0 || !metricRect || metricRect.top >= metricRect.bottom) return null;
		const after = pos > 0 || side > 0;
		const prefixRect = prefixRects[after ? prefixRects.length - 1 : 0]!;
		const x = after ? prefixRect.right : prefixRect.left;
		return { bottom: metricRect.bottom, left: x, right: x, top: metricRect.top };
	}

	toDOM(view: EditorView): HTMLElement {
		const prefix = view.dom.ownerDocument.createElement('span');
		prefix.className = 'paraflow-task-prefix';
		prefix.setAttribute('contenteditable', 'false');
		const marker = view.dom.ownerDocument.createElement('span');
		updateOwnedMarker(marker, this.marker);
		const markerSeparator = view.dom.ownerDocument.createElement('span');
		markerSeparator.className = 'paraflow-task-marker-separator';
		markerSeparator.setAttribute('aria-hidden', 'true');
		markerSeparator.textContent = this.markerSeparator;
		const checkbox = view.dom.ownerDocument.createElement('input');
		checkbox.className = 'task-list-item-checkbox paraflow-task-checkbox';
		checkbox.type = 'checkbox';
		checkbox.checked = this.checked;
		checkbox.tabIndex = -1;
		checkbox.dataset.task = this.checked ? 'x' : '';
		const separator = view.dom.ownerDocument.createElement('span');
		separator.className = 'paraflow-task-content-separator';
		separator.setAttribute('aria-hidden', 'true');
		separator.textContent = this.contentSeparator;
		const caretMetric = view.dom.ownerDocument.createElement('span');
		caretMetric.className = 'paraflow-task-caret-metric';
		caretMetric.setAttribute('aria-hidden', 'true');
		prefix.append(marker, markerSeparator, checkbox, separator, caretMetric);
		return prefix;
	}
}
