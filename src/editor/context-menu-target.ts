import type { EditorView } from '@codemirror/view';

/** The host captures its editor menu during right mousedown, before contextmenu. */
export function bindContextMenuPointerEvents(doc: Document, prepare: (event: MouseEvent) => void, capture: (event: MouseEvent) => void): () => void {
	const down = (event: MouseEvent) => { if (event.button === 2) { capture(event); prepare(event); } };
	const context = (event: MouseEvent) => capture(event);
	doc.addEventListener('mousedown', down, true);
	doc.addEventListener('contextmenu', context, true);
	return () => { doc.removeEventListener('mousedown', down, true); doc.removeEventListener('contextmenu', context, true); };
}

/** A right click on ordinary source text leaves the active native cell before host menu construction. */
export function retargetNativeCellContextMenu(view: EditorView, target: Element, point: { x: number; y: number }, activeCell: boolean): boolean {
	if (!activeCell || target.closest('.cm-editor') !== view.dom || !view.contentDOM.contains(target) || !target.closest('.cm-line') ||
		target.closest('table,.cm-table-widget,.paraflow-table,.internal-embed,a,img')) return false;
	// Focusing the outer editor commits and releases the cell; resolve coordinates against that document.
	view.focus();
	const position = view.posAtCoords(point);
	if (position !== null) view.dispatch({ selection: { anchor: position }, userEvent: 'select.pointer' });
	return true;
}
