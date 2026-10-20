/** Anchor new leading content tabs so Markdown does not reinterpret them as code. */
export function literalBodyTab(before: string): string {
	return /^[ \t]*$/u.test(before) ? '\u200b\t' : '\t';
}

/** The persisted Tab anchor requires editable leading whitespace and a following Tab. */
export function bodyTabDelimiterOffset(body: string): number | null {
	const match = /^[ \t]*\u200b(?=[ \t]*\t)/u.exec(body);
	return match ? match[0].length - 1 : null;
}
