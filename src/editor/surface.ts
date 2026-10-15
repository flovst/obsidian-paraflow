import type { EditorView } from '@codemirror/view';

export type EditorSurfacePredicate = (view: EditorView) => boolean;

export function isPrimarySourceEditor(view: EditorView): boolean {
	if (!view.dom.classList.contains('cm-editor')) return false;
	if (view.dom.closest('.cm-table-widget')) return false;
	const parent = view.dom.parentElement;
	return parent?.matches('.markdown-source-view.mod-cm6') === true;
}

export function isPrimaryLivePreviewEditor(view: EditorView): boolean {
	return isPrimarySourceEditor(view) && view.dom.parentElement?.classList.contains('is-live-preview') === true;
}
