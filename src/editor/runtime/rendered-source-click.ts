import { EditorSelection, Prec, Transaction, type Extension, type StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { beginSourcePointer } from './selection-session.js';

interface SourceHit {
	readonly position: number;
	readonly isOwnerActive: () => boolean;
	readonly anchor?: number;
	readonly effects?: readonly StateEffect<unknown>[];
	readonly onDrag?: () => void;
}

const hits = new WeakMap<MouseEvent, SourceHit>();
const pointerHits = new WeakMap<EditorView, SourceHit>();
const pendingNativeClicks = new WeakSet<EditorView>();

/** Source gestures must reach CM without being intercepted again by their owner. */
export function isRenderedSourceGesture(event: MouseEvent): boolean {
	return hits.has(event);
}
/** Resolve a browser text hit before a host-owned widget changes its DOM. */
export function renderedSourceClickPosition(event: Pick<MouseEvent, 'clientX' | 'clientY'>, element: HTMLElement,
	resolve: (node: Node, offset: number) => number | null): number | null {
	const doc = element.ownerDocument;
	let caret: { offsetNode: Node; offset: number } | null | undefined = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
	if (!caret) {
		const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
		if (range) caret = { offsetNode: range.startContainer, offset: range.startOffset };
	}
	return caret && element.contains(caret.offsetNode) ? resolve(caret.offsetNode, caret.offset) : null;
}

/** The exact source hit remains available while CM owns the corresponding gesture. */
export function renderedSourcePointerPosition(view: EditorView): number | null {
	const hit = pointerHits.get(view);
	return hit?.isOwnerActive() ? hit.position : null;
}

/** Capture the browser text hit before CodeMirror updates widget presentation. */
export function bindRenderedSourceClick(view: EditorView, element: HTMLElement,
	resolve: (node: Node, offset: number) => number | null, isOwnerActive: () => boolean): () => void {
	const down = (event: MouseEvent): void => {
		if (!isOwnerActive() || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.detail > 1 || view.composing) return;
		const position = renderedSourceClickPosition(event, element, resolve);
		if (position !== null) hits.set(event, { position, isOwnerActive });
	};
	element.addEventListener('mousedown', down, true);
	return () => {
		element.removeEventListener('mousedown', down, true);
	};
}

/** Native widgets may ignore CM events. Re-enter its public mouse-selection path at the source root. */
export function handoffRenderedSourceGesture(view: EditorView, event: MouseEvent, position: number,
	isOwnerActive: () => boolean, effects: readonly StateEffect<unknown>[] = [], onDrag?: () => void): void {
	event.preventDefault(); event.stopImmediatePropagation();
	const forwarded = new view.dom.ownerDocument.defaultView!.MouseEvent('mousedown', {
		bubbles: true, cancelable: true, button: event.button, buttons: event.buttons,
		clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY,
		detail: event.detail, shiftKey: event.shiftKey,
	});
	hits.set(forwarded, { position, anchor: event.shiftKey ? view.state.selection.main.anchor : position, isOwnerActive, effects, onDrag });
	pendingNativeClicks.add(view);
	view.contentDOM.dispatchEvent(forwarded);
}

const sourceMouseSelection = Prec.highest(EditorView.mouseSelectionStyle.of((view, event) => {
	const hit = hits.get(event);
	if (!hit?.isOwnerActive()) return null;
	pointerHits.set(view, hit);
	view.focus();
	view.dispatch({ selection: EditorSelection.single(hit.anchor ?? hit.position, hit.position), effects: [beginSourcePointer.of(null), ...hit.effects ?? []],
		annotations: Transaction.userEvent.of('select.pointer') });
	let anchor = hit.anchor ?? hit.position;
	let cancelled = false;
	let dragging = false;
	let entered = false;
	return {
		get(current) {
			if (cancelled || pointerHits.get(view) !== hit || !hit.isOwnerActive()) return view.state.selection;
			const first = !entered;
			entered = true;
			// Four CSS pixels distinguish click jitter from a drag; once crossed, use live geometry throughout.
			if (!dragging && Math.max(Math.abs(current.clientX - event.clientX), Math.abs(current.clientY - event.clientY)) > 4) {
				dragging = true;
				hit.onDrag?.();
			}
			if (hit.onDrag && !first && !dragging) return view.state.selection;
			const head = dragging ? view.posAtCoords({ x: current.clientX, y: current.clientY }, false) : hit.position;
			return EditorSelection.single(anchor, head ?? anchor);
		},
		update(update) {
			if (update.docChanged || update.transactions.some(transaction => transaction.reconfigured)) {
				cancelled = true;
				pointerHits.delete(view);
			} else anchor = update.changes.mapPos(anchor);
			return false;
		},
	};
}));

const sourcePointerLifecycle = ViewPlugin.define(view => {
	const clear = (): void => { pointerHits.delete(view); };
	const cancel = (): void => { clear(); pendingNativeClicks.delete(view); };
	const down = (event: MouseEvent): void => { if (!hits.has(event)) pendingNativeClicks.delete(view); };
	const click = (event: MouseEvent): void => {
		if (!pendingNativeClicks.has(view)) return;
		// Table entry uses its existing cell activation while the outer source gesture remains held.
		if (pointerHits.get(view)?.onDrag && (event.target as Element).closest('td,th')) return;
		pendingNativeClicks.delete(view);
		event.preventDefault(); event.stopImmediatePropagation();
	};
	const doc = view.dom.ownerDocument;
	doc.addEventListener('mouseup', clear);
	doc.defaultView!.addEventListener('blur', cancel);
	view.dom.addEventListener('mousedown', down, true);
	view.dom.addEventListener('click', click, true);
	return { destroy() {
		cancel();
		doc.removeEventListener('mouseup', clear);
		doc.defaultView!.removeEventListener('blur', cancel);
		view.dom.removeEventListener('mousedown', down, true);
		view.dom.removeEventListener('click', click, true);
	} };
});

/** CM owns drag selection, autoscroll, release and cancellation; no corrective timers. */
export function createRenderedSourceClickExtension(): Extension {
	return [sourceMouseSelection, sourcePointerLifecycle];
}
