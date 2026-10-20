import { Facet, type EditorState } from '@codemirror/state';

export interface ContainerBodyLine {
	readonly from: number;
	readonly to: number;
	readonly bodyFrom: number;
	readonly emptyAnchor: number | null;
}

export const containerBodyLineProviders = Facet.define<(state: EditorState, position: number) => ContainerBodyLine | null>();

/** Container owners expose editable row boundaries without coupling navigation to their parser. */
export function containerBodyLine(state: EditorState, position: number): ContainerBodyLine | null {
	for (const provider of state.facet(containerBodyLineProviders)) {
		const line = provider(state, position);
		if (line) return line;
	}
	return null;
}

export function normalizeContainerBodyEndpoint(state: EditorState, position: number, bias: -1 | 1): number {
	const line = containerBodyLine(state, position);
	if (!line || position >= line.bodyFrom) return position;
	return bias > 0 || line.from === 0 ? line.bodyFrom : line.from - 1;
}
