import type { EditorState } from '@codemirror/state';
import { syntaxTreeAvailable } from '@codemirror/language';
import { quoteContainers } from './callout/presentation-model.js';
import { projectQuoteContent } from './callout/projection.js';
import { planListContinuationMaintenance, type ListMaintenanceInsertion } from './structured-list/source-maintenance.js';

/** The same list rule applies inside source-proven quote and Callout content. */
export function planListIndentMaintenance(state: EditorState): readonly ListMaintenanceInsertion[] {
	const changes = [...planListContinuationMaintenance(state)];
	for (const card of quoteContainers(state)) {
		if (!syntaxTreeAvailable(state, card.to)) continue;
		const first = card.kind === 'callout' ? card.headerTo + 1 : card.from;
		const content = projectQuoteContent(state, first, card.to, card.depth);
		if (!content) continue;
		for (const change of planListContinuationMaintenance(content.state)) {
			changes.push({ from: content.toSource(change.from), insert: change.insert });
		}
	}
	return changes.sort((left, right) => left.from - right.from);
}
