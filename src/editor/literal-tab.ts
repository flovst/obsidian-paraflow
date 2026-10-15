/** Anchor new leading content tabs so Markdown does not reinterpret them as code. */
export function literalBodyTab(before: string): string {
	return /^[ \t]*$/u.test(before) ? '\u200b\t' : '\t';
}
