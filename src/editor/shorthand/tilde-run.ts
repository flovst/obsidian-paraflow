import { Facet, StateField, type EditorState } from '@codemirror/state';
import { shorthandAnalysis, type ShorthandSettings, type TildeRun } from './syntax.js';

export const shorthandSettings = Facet.define<() => ShorthandSettings, (() => ShorthandSettings) | null>({
	combine: values => values[0] ?? null,
});
export const tildeRuns = StateField.define<readonly TildeRun[]>({
	create: state => shorthandAnalysis(state.doc).tildeRuns,
	update: (value, transaction) => transaction.docChanged ? shorthandAnalysis(transaction.newDoc).tildeRuns : value,
});

export function ownsTildeRun(state: EditorState, from: number, to: number): boolean {
	return Boolean(state.facet(shorthandSettings)?.().subscript &&
		state.field(tildeRuns).some(run => run.from <= from && run.to >= to));
}
