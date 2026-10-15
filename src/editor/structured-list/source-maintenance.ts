import type { EditorState } from '@codemirror/state';
import { syntaxTreeAvailable } from '@codemirror/language';
import { markdownColumns } from './prefix.js';
import { enumerateListItems, listParagraphContinuations } from './syntax.js';

export interface ListMaintenanceInsertion {
	readonly from: number;
	readonly insert: string;
}

export function planListContinuationMaintenance(state: EditorState): readonly ListMaintenanceInsertion[] {
	const items = new Map(enumerateListItems(state).map(item => [state.doc.lineAt(item.markerLine.from).number, item]));
	const changes: ListMaintenanceInsertion[] = [];
	for (const fact of listParagraphContinuations(state)) {
		const owner = items.get(fact.ownerLineNumber);
		const line = state.doc.line(fact.lineNumber);
		if (!owner || line.to > owner.itemNode.to || !syntaxTreeAvailable(state, line.to)) continue;
		const indent = /^[ \t]*/u.exec(line.text)![0];
		const ownerIndent = /^[ \t]*/u.exec(state.doc.lineAt(owner.markerLine.from).text)![0];
		const missingColumns = markdownColumns(ownerIndent) - markdownColumns(indent);
		if (missingColumns > 0) changes.push({ from: line.from + indent.length, insert: ' '.repeat(missingColumns) });
	}
	return changes.sort((left, right) => left.from - right.from);
}
