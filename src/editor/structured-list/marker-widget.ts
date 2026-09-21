import { WidgetType, type EditorView } from '@codemirror/view';
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

export class SelectedTaskTokenWidget extends WidgetType {
	constructor(
		readonly checked: boolean,
		readonly contentSeparator: string,
	) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof SelectedTaskTokenWidget &&
			other.checked === this.checked &&
			other.contentSeparator === this.contentSeparator;
	}

	ignoreEvent(): boolean {
		return true;
	}

	toDOM(view: EditorView): HTMLElement {
		const token = view.dom.ownerDocument.createElement('span');
		token.className = 'paraflow-selection-task-token';
		token.setAttribute('aria-hidden', 'true');
		token.setAttribute('contenteditable', 'false');
		const checkbox = view.dom.ownerDocument.createElement('input');
		checkbox.className = 'task-list-item-checkbox paraflow-selection-task-checkbox';
		checkbox.type = 'checkbox';
		checkbox.checked = this.checked;
		checkbox.tabIndex = -1;
		checkbox.setAttribute('aria-hidden', 'true');
		checkbox.setAttribute('contenteditable', 'false');
		const contentSeparator = view.dom.ownerDocument.createElement('span');
		contentSeparator.className = 'paraflow-selection-task-content-separator';
		contentSeparator.textContent = this.contentSeparator;
		token.append(checkbox, contentSeparator);
		return token;
	}
}
