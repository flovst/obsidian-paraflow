import { EditorState, Prec, type ChangeSpec, type Extension, type Line, type Transaction } from '@codemirror/state';
import { getStructuredListNumberedPrefixes } from './projection.js';
import { numberingIntent, preservesListOwnership, type ExpectedNumber } from './numbering-intent.js';
import { getParagraphProjectionState } from '../paragraph/projection.js';

function captureNumbers(transaction: Transaction): readonly ExpectedNumber[] {
	// With no digit + delimiter there can be no ordered prefix to protect. Avoid materializing
	// the next state (and all its presentation fields) from inside this filter.
	if (!/[0-9][.)]/u.test(transaction.newDoc.toString())) return [];
	const previous = getStructuredListNumberedPrefixes(transaction.startState);
	const stable = preservesNumberedOwnership(transaction, previous);
	const prefixes = stable ? previous.map(prefix => ({
		from: transaction.changes.mapPos(prefix.from, 1),
		to: transaction.changes.mapPos(prefix.to, 1),
	})) : getStructuredListNumberedPrefixes(transaction.state);
	return prefixes.map(prefix => {
		const { from, to } = prefix;
		const text = transaction.newDoc.sliceString(from, to);
		const match = /^(.*?)(\d+)([.)][ \t])/u.exec(text)!;
		return { from, before: match[1]!, number: match[2]!, after: match[3]! };
	});
}

/** Plain body text cannot change a marker or open/close a Markdown container. */
const plainBody = /^[\p{L}\p{N} \t.,，。!?！？]*$/u;

function plainParagraph(before: Line, after: Line): boolean {
	return /^\p{L}/u.test(before.text) && /^\p{L}/u.test(after.text) && plainBody.test(before.text) && plainBody.test(after.text);
}

function paragraphSplit(transaction: Transaction, line: Line, from: number): boolean {
	const paragraph = getParagraphProjectionState(transaction.startState)?.authority.blocks.find(block =>
		block.kind === 'paragraph' && block.from === line.from && block.to === line.to);
	return paragraph !== undefined && from > line.from && plainParagraph(line, line);
}

function stableBodyChange(transaction: Transaction, byLine: ReadonlyMap<number, { from: number; to: number }>,
	from: number, to: number, newFrom: number, newTo: number, inserted: string): boolean {
	const before = transaction.startState.doc.lineAt(from);
	const after = transaction.newDoc.lineAt(newFrom);
	if (from === to && /^\n+$/u.test(inserted)) return paragraphSplit(transaction, before, from) &&
		splitStaysParagraph(transaction, after.number, transaction.newDoc.lineAt(newTo).number);
	if (to > before.to || newTo > after.to || !plainBody.test(inserted)) return false;
	const prefix = byLine.get(before.from);
	if (!prefix) return plainParagraph(before, after);
	return stableListBody(transaction, prefix.to, before, after, from);
}

function splitStaysParagraph(transaction: Transaction, first: number, last: number): boolean {
	for (let number = first; number <= last; number++) {
		const text = transaction.newDoc.line(number).text;
		if (text !== '' && !/^\p{L}/u.test(text)) return false;
	}
	return true;
}

function stableListBody(transaction: Transaction, prefixEnd: number, before: Line, after: Line, from: number): boolean {
	return from >= prefixEnd && plainBody.test(transaction.startState.doc.sliceString(prefixEnd, before.to)) &&
		plainBody.test(transaction.newDoc.sliceString(transaction.changes.mapPos(prefixEnd, -1), after.to));
}

function preservesNumberedOwnership(transaction: Transaction, prefixes: readonly { from: number; to: number }[]): boolean {
	if (transaction.effects.length) return false;
	if (validatedOpaqueReplacement(transaction)) return !prefixes.some(prefix => transaction.changes.touchesRange(prefix.from, prefix.to));
	const byLine = new Map(prefixes.map(prefix => [prefix.from, prefix]));
	let stable = true;
	transaction.changes.iterChanges((from, to, newFrom, newTo, inserted) => {
		stable = stable && stableBodyChange(transaction, byLine, from, to, newFrom, newTo, inserted.toString());
	});
	return stable;
}

function validatedOpaqueReplacement(transaction: Transaction): boolean {
	const expected = transaction.annotation(preservesListOwnership);
	if (!expected) return false;
	let count = 0, matches = false;
	transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
		count++;
		matches = from === expected.from && to === expected.to && inserted.toString() === expected.insert;
	});
	return count === 1 && matches;
}

function restoreNumbers(transaction: Transaction, expected: readonly ExpectedNumber[]): readonly ChangeSpec[] {
	return expected.flatMap(number => {
		const line = transaction.newDoc.lineAt(number.from);
		if (line.from !== number.from) return [];
		const text = transaction.newDoc.sliceString(number.from + number.before.length, line.to);
		const digits = /^\d+/u.exec(text)?.[0];
		if (!digits || digits === number.number ||
			transaction.newDoc.sliceString(number.from, number.from + number.before.length) !== number.before ||
			!text.slice(digits.length).startsWith(number.after)) return [];
		const from = number.from + number.before.length;
		return [{ from, to: from + digits.length, insert: number.number }];
	});
}

/** Preserve the editor's planned numbering while host filters process the same edit. */
export function createNumberingOwnership(isActive: (state: EditorState) => boolean): Extension {
	return [
		Prec.lowest(EditorState.transactionFilter.of(transaction => {
			if (!transaction.docChanged || !isActive(transaction.startState)) return transaction;
			const numbers = captureNumbers(transaction);
			return numbers.length ? [transaction, { effects: numberingIntent.of(numbers), sequential: true }] : transaction;
		})),
		// Filters execute in reverse precedence. Effects map through every intervening edit.
		Prec.highest(EditorState.transactionFilter.of(transaction => {
			const intent = transaction.effects.find(effect => effect.is(numberingIntent));
			if (!intent) return transaction;
			const changes = restoreNumbers(transaction, intent.value);
			return changes.length ? [transaction, { changes, sequential: true }] : transaction;
		})),
	];
}
