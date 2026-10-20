import type { EditorState } from '@codemirror/state';
import { createdBodyOwnership } from './runtime/empty-body-state.js';
import { planListIndentMaintenance } from './list-indent-maintenance.js';
import type { ListMaintenanceInsertion } from './structured-list/source-maintenance.js';
import { scanMathRanges } from './math/range-scanner.js';

/** Persist only boundaries established by editing; imported whitespace has no inferred history. */
export function planManualSaveMaintenance(state: EditorState): readonly ListMaintenanceInsertion[] {
	const syntax = scanMathRanges(state.doc.toString());
	const protectedRanges = [...syntax.opaque, ...syntax.expressions, ...syntax.candidates];
	const insertions = new Map<number, string>();
	for (const change of planListIndentMaintenance(state)) {
		insertions.set(change.from, (insertions.get(change.from) ?? '') + change.insert);
	}
	const boundaries = new Set<number>();
	for (const { bodyFrom } of createdBodyOwnership(state)) {
		if (protectedRanges.some(range => range.from <= bodyFrom && bodyFrom < range.to)) continue;
		const body = state.sliceDoc(bodyFrom, state.doc.lineAt(bodyFrom).to);
		if (body === '' || /^[ \t]/u.test(body)) boundaries.add(bodyFrom);
	}
	for (const from of boundaries) {
		insertions.set(from, (insertions.get(from) ?? '') + '\u200b');
	}
	return [...insertions].sort(([left], [right]) => left - right).map(([from, insert]) => ({ from, insert }));
}
