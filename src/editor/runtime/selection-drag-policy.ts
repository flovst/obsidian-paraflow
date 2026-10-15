import { Facet, Prec, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

export interface SelectionDragPolicyOptions {
	readonly disableSelectedTextDrag: () => boolean;
	readonly isActive: (view: EditorView) => boolean;
}

const selectionDragPolicyOptions = Facet.define<
	SelectionDragPolicyOptions,
	readonly SelectionDragPolicyOptions[]
>({
	combine: (options) => [...options],
});

function policyEnabled(view: EditorView): boolean {
	return view.state.facet(selectionDragPolicyOptions).some((options) =>
		options.isActive(view) && options.disableSelectedTextDrag());
}

class SelectionDragPolicyPlugin {
	private armed = false;
	private readonly ownerDocument: Document;
	private readonly resetOnDocumentMouseUp = (): void => {
		this.armed = false;
	};

	constructor(readonly view: EditorView) {
		this.ownerDocument = view.dom.ownerDocument;
		for (const event of ['mouseup', 'pointerup', 'pointercancel']) {
			this.ownerDocument.addEventListener(event, this.resetOnDocumentMouseUp, true);
		}
		this.ownerDocument.defaultView?.addEventListener('blur', this.resetOnDocumentMouseUp);
	}

	destroy(): void {
		for (const event of ['mouseup', 'pointerup', 'pointercancel']) {
			this.ownerDocument.removeEventListener(event, this.resetOnDocumentMouseUp, true);
		}
		this.ownerDocument.defaultView?.removeEventListener('blur', this.resetOnDocumentMouseUp);
	}

	update(update: ViewUpdate): void {
		if (update.docChanged || !policyEnabled(this.view) ||
			update.transactions.some(transaction => transaction.reconfigured)) this.armed = false;
	}

	handleMouseDown(event: MouseEvent): boolean {
		this.armed = false;
		if (event.button !== 0 || !policyEnabled(this.view)) return false;
		const ElementConstructor = this.ownerDocument.defaultView?.Element;
		const target = ElementConstructor && event.target instanceof ElementConstructor
			? event.target
			: null;
		if (target?.closest(
			'[draggable="true"], .cm-widget, .cm-widgetBuffer, [contenteditable="false"]',
		)) return false;
		const position = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
		if (position === null) return false;
		this.armed = this.view.state.selection.ranges.some((range) =>
			!range.empty && range.from <= position && position < range.to);
		return false;
	}

	handleDragStart(event: DragEvent): boolean {
		if (!this.armed || !policyEnabled(this.view)) {
			this.armed = false;
			return false;
		}
		this.armed = false;
		event.preventDefault();
		event.stopPropagation();
		return true;
	}

	reset(): boolean {
		this.armed = false;
		return false;
	}
}

const selectionDragPolicyPlugin = Prec.highest(ViewPlugin.fromClass(
	SelectionDragPolicyPlugin,
	{
		eventHandlers: {
			compositionstart() {
				return this.reset();
			},
			blur() {
				return this.reset();
			},
			dragend() {
				return this.reset();
			},
			dragstart(event) {
				return this.handleDragStart(event);
			},
			mousedown(event) {
				return this.handleMouseDown(event);
			},
			mouseup() {
				return this.reset();
			},
		},
	},
));

export function createSelectionDragPolicy(options: SelectionDragPolicyOptions): Extension {
	return [selectionDragPolicyOptions.of(options), selectionDragPolicyPlugin];
}
