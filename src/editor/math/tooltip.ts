import type { EditorView, Rect, TooltipView } from '@codemirror/view';
import type { MathExpression } from './syntax.js';

export function visibleMathBounds(rects: readonly Rect[], viewport: Rect): Rect | null {
	const visible = rects.filter(rect => rect.right > viewport.left && rect.left < viewport.right &&
		rect.bottom > viewport.top && rect.top < viewport.bottom);
	if (!visible.length) return null;
	const left = Math.max(viewport.left, Math.min(...visible.map(rect => rect.left)));
	const right = Math.min(viewport.right, Math.max(...visible.map(rect => rect.right)));
	const center = (left + right) / 2;
	return { left: center, right: center, top: Math.max(viewport.top, Math.min(...visible.map(rect => rect.top))),
		bottom: Math.min(viewport.bottom, Math.max(...visible.map(rect => rect.bottom))) };
}

export function centeredTooltipLeft(center: number, width: number, space: Pick<Rect, 'left' | 'right'>): number {
	return Math.max(space.left, Math.min(center - width / 2, space.right - width));
}

export function mathTooltipPosition(view: EditorView, math: MathExpression, dom: HTMLElement):
	Pick<TooltipView, 'getCoords' | 'positioned'> {
	let anchor: Rect;
	return {
		getCoords() {
			const start = view.domAtPos(math.from);
			const end = view.domAtPos(math.to);
			const range = view.dom.ownerDocument.createRange();
			range.setStart(start.node, start.offset);
			range.setEnd(end.node, end.offset);
			const caret = view.coordsAtPos(view.state.selection.main.head) ?? view.contentDOM.getBoundingClientRect();
			const scroller = view.scrollDOM.getBoundingClientRect();
			const ownerWindow = view.dom.ownerDocument.defaultView!;
			const viewport = { left: Math.max(0, scroller.left), right: Math.min(ownerWindow.innerWidth, scroller.right),
				top: Math.max(0, scroller.top), bottom: Math.min(ownerWindow.innerHeight, scroller.bottom) };
			anchor = visibleMathBounds([...range.getClientRects()], viewport) ?? caret;
			return anchor;
		},
		positioned(space) {
			const rect = dom.getBoundingClientRect();
			const left = centeredTooltipLeft(anchor.left, rect.width, space);
			// The delta works for CM's fixed and transformed/absolute tooltip parents.
			dom.style.left = `${parseFloat(dom.style.left) + (left - rect.left) / view.scaleX}px`;
			const arrow = dom.querySelector<HTMLElement>('.cm-tooltip-arrow');
			if (arrow) arrow.style.left = `${(anchor.left - left) / view.scaleX - 7}px`;
		},
	};
}
