import { Facet, type EditorState } from '@codemirror/state';
export interface PendingMathRange {
    readonly from: number;
    readonly to: number;
}
export const pendingMath = Facet.define<readonly PendingMathRange[], readonly PendingMathRange[]>({ combine: values => values[0] ?? [] });
export const mathCandidatesActive = Facet.define<boolean, boolean>({ combine: values => values[0] ?? false });
export function pendingMathRanges(state: EditorState): readonly PendingMathRange[] { return state.facet(pendingMath); }
export function pendingMathAt(state: EditorState, from: number, to = from): boolean { return pendingMathRanges(state).some(range => range.from <= from && to <= range.to); }
