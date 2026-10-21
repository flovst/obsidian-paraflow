import { countColumn, findColumn, Text, type EditorState } from '@codemirror/state';
import type { CodeBlock } from './source-scan.js';

/** Remove only the four-column code prefix; remaining indentation belongs to the container. */
function fencePrefix(prefix: string): string {
	const whitespace = /[ \t]*$/u.exec(prefix)![0];
	const columns = countColumn(whitespace, 4);
	return prefix.slice(0, prefix.length - whitespace.length) + ' '.repeat(Math.max(0, columns - 4));
}

export function planIndentedCodeLanguage(state: EditorState, block: CodeBlock, language: string) {
	const first = block.lines[0]!;
	const codePrefix = state.sliceDoc(first.from, first.contentFrom);
	const prefix = fencePrefix(codePrefix);
	const contentStarts = block.lines.map(line => {
		const text = state.sliceDoc(line.from, line.to);
		return /^[ \t>]*$/u.test(text) ? line.from + findColumn(text, countColumn(codePrefix, 4), 4) : line.contentFrom;
	});
	const bodies = block.lines.map((line, index) => state.sliceDoc(contentStarts[index], line.to));
	const longest = bodies.reduce((length, body) => Math.max(length,
		...[...body.matchAll(/`+/gu)].map(match => match[0].length)), 0);
	const fence = '`'.repeat(Math.max(3, longest + 1));
	return [
		...block.lines.map((line, index) => ({ from: line.from, to: contentStarts[index],
			insert: index === 0 ? Text.of([prefix + fence + language, prefix]) : prefix })),
		{ from: block.lines.at(-1)!.to, insert: Text.of(['', prefix + fence]) },
	];
}
