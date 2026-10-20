export function quotePrefix(text: string, depth: number): string | null {
	let length = 0;
	for (let index = 0; index < depth; index += 1) {
		const match = (index === 0 ? /^[ \t]*>[ \t]?/u : /^ {0,3}>[ \t]?/u).exec(text.slice(length));
		if (!match) return null;
		length += match[0].length;
	}
	return text.slice(0, length);
}
