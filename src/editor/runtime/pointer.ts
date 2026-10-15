import type { EditorState, Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { createDragCaretExtension } from './drag-caret.js';
import { createSelectionDragPolicy } from './selection-drag-policy.js';

export interface EditorPointerOptions {
	readonly disableSelectedTextDrag: () => boolean;
	readonly hideCaretWhileDragSelecting: () => boolean;
	readonly isActive: (view: EditorView) => boolean;
	readonly isLivePreview: (state: EditorState) => boolean;
}

/** Primary-editor preferences remain installed independently of content editing modules. */
export function createEditorPointerExtension(options: EditorPointerOptions): Extension {
	return [createDragCaretExtension(options), createSelectionDragPolicy(options)];
}
