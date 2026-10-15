import type { Text } from '@codemirror/state';

/** Two genuinely empty source rows end a list group; indented blanks remain inside it. */
export function listGroupBoundary(doc: Text, from: number, to: number): number | null {
	let number = doc.lineAt(to).number - 1;
	let count = 0;
	while (number > doc.lineAt(from).number && doc.line(number).text.length === 0) { count++; number--; }
	return count >= 2 ? doc.line(number).to : null;
}

export function hasListGroupBoundary(source: string, from: number, to: number): boolean {
	return /\n\n\n[ \t]*$/u.test(source.slice(from, to));
}
