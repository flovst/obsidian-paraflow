import type { EditorState, Text } from '@codemirror/state';

const bodyStarts = new WeakMap<Text, number>();

/** The editable body starts after a complete frontmatter block. */
export function documentBodyStart(state: EditorState): number {
	const doc = state.doc, cached = bodyStarts.get(doc);
	if (cached !== undefined) return cached;
	let start = 0;
	if (doc.line(1).text === '---') for (let number = 2; number <= doc.lines; number++) {
		const line = doc.line(number);
		if (line.text === '---' || line.text === '...') {
			start = Math.min(doc.length, line.to + 1);
			break;
		}
	}
	bodyStarts.set(doc, start);
	return start;
}
