import { EditorState, type ChangeSpec, type Extension, Transaction } from '@codemirror/state';
import { classifyCurrentSelectionMode, excludedSelectionModeForTransaction, requireCompositionState } from '../runtime/input-state.js';
import { prefixPolicy } from './prefix.js';
import { discoverListItem } from './syntax.js';
import { structuralEditAnnotation } from './edit-plan.js';
import { projectedQuoteMarkerOffset } from './projection.js';

interface ChangedMarkerLine { readonly number: number; readonly offset: number }

function provenMarkerOffset(state: EditorState, position: number): number | null {
	const line = state.doc.lineAt(position);
	const owner = discoverListItem(state, position);
	if (owner && state.doc.lineAt(owner.markerLine.from).number === line.number &&
		/^[ \t]*$/u.test(state.sliceDoc(line.from, owner.markerLine.from))) return 0;
	return projectedQuoteMarkerOffset(state, position);
}

function changedMarkerLines(transaction: Transaction): readonly ChangedMarkerLine[] {
	const lines = new Map<number, number>();
	transaction.changes.iterChangedRanges((from, _to, newFrom) => {
		const offset = provenMarkerOffset(transaction.startState, from);
		if (offset === null) return;
		const newLine = transaction.state.doc.lineAt(newFrom);
		lines.set(newLine.number, offset);
	});
	return [...lines].map(([number, offset]) => ({ number, offset }));
}

function needsSentinel(body: string): boolean {
	const leading = /^[ \t]*/u.exec(body)![0];
	return leading.includes('\t') || leading.length >= 4;
}

function sentinelChange(at: number, present: boolean, required: boolean): ChangeSpec | null {
	if (present === required) return null;
	return present ? { from: at, to: at + 1, insert: '' } : { from: at, insert: '\u200b' };
}

function markerSentinelChange(state: EditorState, { number, offset }: ChangedMarkerLine): ChangeSpec | null {
	const line = state.doc.line(number);
	const prefix = prefixPolicy.parse(line.text.slice(offset), line.from + offset);
	if (!prefix) return null;
	const at = prefix.taskToken?.to ?? prefix.outerMarker.to;
	const hasSentinel = state.sliceDoc(at, at + 1) === '\u200b';
	const body = state.sliceDoc(at + (hasSentinel ? 1 : 0), line.to);
	const required = needsSentinel(body);
	return sentinelChange(at, hasSentinel, required);
}

/** Maintain only changed, proven marker bodies in the same input transaction. */
function isBodyEdit(transaction: Transaction): boolean {
	return transaction.isUserEvent('input') || transaction.isUserEvent('delete') ||
		transaction.annotation(structuralEditAnnotation) !== undefined;
}

function normalOwner(transaction: Transaction): boolean {
	const mode = classifyCurrentSelectionMode(transaction.startState);
	return (mode === 'caret' || mode === 'continuous') &&
		!requireCompositionState(transaction.startState) && !requireCompositionState(transaction.state) &&
		excludedSelectionModeForTransaction(transaction) === null;
}

export function createListBodyPrefixMaintenance(isActive: (state: EditorState) => boolean): Extension {
	return EditorState.transactionFilter.of(transaction => {
		if (!transaction.docChanged || !isActive(transaction.startState) || !normalOwner(transaction)) return transaction;
		if (!isBodyEdit(transaction)) return transaction;
		const changes = changedMarkerLines(transaction).flatMap(line => {
			const change = markerSentinelChange(transaction.state, line);
			return change ? [change] : [];
		});
		return changes.length ? [transaction, { changes, sequential: true }] : transaction;
	});
}
