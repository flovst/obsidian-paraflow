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
const SHAPES: readonly StructuredListMarkerShape[] = ['disc', 'ring', 'square'];
const SHAPE_GLYPHS: Readonly<Record<StructuredListMarkerShape, string>> = {
	disc: '•',
	ring: '○',
	square: '▪',
};

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

function updateOwnedMarker(dom: HTMLElement, marker: StructuredListMarker): void {
	dom.className = markerClasses(marker);
	dom.textContent = marker.label ?? SHAPE_GLYPHS[marker.shape];
	dom.setAttribute('aria-hidden', 'true');
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
