import { Facet, StateField, type EditorState } from '@codemirror/state';
import { discoverTildeRuns, type ShorthandSettings, type TildeRun } from './syntax.js';

export const shorthandSettings = Facet.define<() => ShorthandSettings, (() => ShorthandSettings) | null>({
	combine: values => values[0] ?? null,
});
export const tildeRuns = StateField.define<readonly TildeRun[]>({
	create: state => discoverTildeRuns(state.doc.toString()),
	update: (value, transaction) => transaction.docChanged ? discoverTildeRuns(transaction.newDoc.toString()) : value,
});

export function ownsTildeRun(state: EditorState, from: number, to: number): boolean {
	return Boolean(state.facet(shorthandSettings)?.().subscript &&
		state.field(tildeRuns).some(run => run.from <= from && run.to >= to));
}
