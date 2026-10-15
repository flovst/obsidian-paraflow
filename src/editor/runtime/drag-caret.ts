import { type EditorState, type Extension, Facet, Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

const DRAG_CURSOR_CLASS = 'paraflow-drag-cursor-hidden';

export interface DragCaretOptions {
	readonly hideCaretWhileDragSelecting?: () => boolean;
	readonly isActive: (view: EditorView) => boolean;
	readonly isLivePreview?: (state: EditorState) => boolean;
}

const dragCaretOptions = Facet.define<DragCaretOptions>();

function isActive(view: EditorView): boolean {
	return view.state.facet(dragCaretOptions).every(options => options.isActive(view) && (options.hideCaretWhileDragSelecting?.() ?? true));
}

function isLivePreview(state: EditorState): boolean {
	return state.facet(dragCaretOptions).every(options => options.isLivePreview?.(state) ?? true);
}

const dragCaretPlugin = ViewPlugin.define(view => {
	let pressed = false;
	let hidden = false;
	let livePreview = isLivePreview(view.state);
	const ownerDocument = view.dom.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	const setHidden = (value: boolean) => {
		hidden = value;
		view.dom.classList.toggle(DRAG_CURSOR_CLASS, hidden);
	};
	const reset = () => {
		pressed = false;
		setHidden(false);
	};
	const release = (event: MouseEvent) => {
		if (event.button === 0) reset();
	};
	ownerDocument.addEventListener('mouseup', release, true);
	ownerDocument.addEventListener('pointerup', release, true);
	ownerDocument.addEventListener('pointercancel', reset, true);
	ownerWindow?.addEventListener('blur', reset);
	return {
		get hidden() { return hidden; },
		reset,
		press(event: MouseEvent) {
			reset();
			pressed = event.button === 0 && !event.shiftKey && event.detail < 2 &&
				!view.composing && isActive(view);
		},
		update(update: ViewUpdate) {
			const nextLivePreview = isLivePreview(update.state);
			const modeChanged = nextLivePreview !== livePreview;
			livePreview = nextLivePreview;
			if (modeChanged || update.docChanged || view.composing || !isActive(view) ||
				update.transactions.some(transaction => transaction.reconfigured)) {
				reset();
				return;
			}
			for (const transaction of update.transactions) {
				if (!pressed || !transaction.selection) continue;
				if (transaction.isUserEvent('select.pointer')) {
					if (!transaction.newSelection.eq(transaction.startState.selection)) {
						setHidden(!transaction.newSelection.main.empty);
					}
				} else if (transaction.annotation(Transaction.userEvent) !== undefined) {
					reset();
				} else if (transaction.newSelection.main.empty) {
					setHidden(false);
				}
			}
		},
		destroy() {
			reset();
			ownerDocument.removeEventListener('mouseup', release, true);
			ownerDocument.removeEventListener('pointerup', release, true);
			ownerDocument.removeEventListener('pointercancel', reset, true);
			ownerWindow?.removeEventListener('blur', reset);
		},
	};
}, {
	eventObservers: {
		mousedown(event) { this.press(event); },
		blur() { this.reset(); },
		compositionstart() { this.reset(); },
		dragstart() { this.reset(); },
	},
});

const dragCaretPresentation = [
	EditorView.editorAttributes.of(view => ({ class: view.plugin(dragCaretPlugin)?.hidden ? DRAG_CURSOR_CLASS : '' })),
	EditorView.baseTheme({
		[`&.${DRAG_CURSOR_CLASS} > .cm-scroller > .cm-cursorLayer > .cm-cursor`]: { visibility: 'hidden !important' },
		[`&.${DRAG_CURSOR_CLASS} > .cm-scroller > .cm-content`]: { caretColor: 'transparent !important' },
		[`&.${DRAG_CURSOR_CLASS} > .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content`]: { caretColor: 'transparent !important' },
	}),
];

/** Cosmetic pointer state is independent of Live Preview selection projection. */
export function createDragCaretExtension(options: DragCaretOptions): Extension {
	return [
		dragCaretOptions.of(options),
		dragCaretPlugin,
		dragCaretPresentation,
	];
}
