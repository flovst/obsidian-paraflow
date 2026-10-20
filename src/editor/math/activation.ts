import { Facet, type EditorState } from '@codemirror/state';

/** Lets shared caret protection defer to native math when ParaFlow does not own it. */
export const mathEditingActivation = Facet.define<(state: EditorState) => boolean>();
