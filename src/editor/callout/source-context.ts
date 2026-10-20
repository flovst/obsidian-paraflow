import type { EditorState } from '@codemirror/state';
import { codeDraft } from '../code-blocks/draft-state.js';
import { pendingMathRanges } from '../math/candidate-ranges.js';
import { mathRangeIndex } from '../math/syntax.js';
import { createdBodyOwnership, emptyBodies } from '../runtime/empty-body-state.js';
import { quoteDraftMasks } from './quote-draft.js';

/** Dependencies of source-owned cards, independent of native parse progress and selection. */
export function containerSourceContext(state: EditorState) {
	return { draft: state.facet(codeDraft), quotes: state.facet(quoteDraftMasks), math: mathRangeIndex(state) };
}

type SourceContext = ReturnType<typeof containerSourceContext>;

function sameRecord<T extends object>(a: T | null, b: T | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	const keys = Object.keys(a) as (keyof T)[];
	return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

function sameRecords<T extends object>(a: readonly T[], b: readonly T[]): boolean {
	return a === b || a.length === b.length && a.every((value, index) => sameRecord(value, b[index]!));
}

export function sameContainerSource(a: SourceContext, b: SourceContext): boolean {
	return a.math === b.math && sameRecord(a.draft, b.draft) && sameRecords(a.quotes, b.quotes);
}

/** Body ownership includes effect-only/history changes even when Text identity stays unchanged. */
export function containerBodyContext(state: EditorState) {
	return { ...containerSourceContext(state), pending: pendingMathRanges(state),
		empty: emptyBodies(state), created: createdBodyOwnership(state) };
}

export function sameContainerBody(a: ReturnType<typeof containerBodyContext>, b: ReturnType<typeof containerBodyContext>): boolean {
	return sameContainerSource(a, b) && sameRecords(a.pending, b.pending) && sameRecords(a.created, b.created) &&
		(a.empty === b.empty || a.empty.length === b.empty.length && a.empty.every((value, index) => value === b.empty[index]));
}
