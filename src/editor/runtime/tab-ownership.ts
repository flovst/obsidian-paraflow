import type { EditorView } from '@codemirror/view';

/** Completion keeps Tab before semantic source editors handle it. */
export function completionOwnsTab(view: EditorView): boolean {
	if (view.contentDOM.getAttribute('aria-autocomplete') === 'list' && view.contentDOM.getAttribute('aria-expanded') === 'true') return true;
	// Obsidian's native suggest popup is outside the editor and has no completion ARIA.
	return [...view.dom.ownerDocument.querySelectorAll<HTMLElement>('.suggestion-container')].some(popup =>
		popup.getClientRects().length > 0 && popup.querySelector('.suggestion > .suggestion-item.is-selected') !== null);
}
