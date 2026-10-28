import { EditorState, Prec, StateEffect, type ChangeSpec, type Extension, type Transaction } from '@codemirror/state';
import { getStructuredListNumberedPrefixes } from './projection.js';

interface ExpectedNumber {
	readonly from: number;
	readonly before: string;
	readonly number: string;
	readonly after: string;
}

const numberingIntent = StateEffect.define<readonly ExpectedNumber[]>({
	map: (numbers, changes) => numbers.map(number => ({ ...number, from: changes.mapPos(number.from, 1) })),
});

function captureNumbers(transaction: Transaction): readonly ExpectedNumber[] {
	const prefixes = getStructuredListNumberedPrefixes(transaction.state);
	return prefixes.map(prefix => {
		const { from, to } = prefix;
		const text = transaction.newDoc.sliceString(from, to);
		const match = /^(.*?)(\d+)([.)][ \t])/u.exec(text)!;
		return { from, before: match[1]!, number: match[2]!, after: match[3]! };
	});
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
