/** Parser-only markers cannot collide with literal or decoded user characters. */
export function mathSourceMarkers(source: string): () => string {
	let code = 0xe000;
	const lower = source.toLowerCase();
	return () => {
		while (code <= 0xf8ff && (source.includes(String.fromCharCode(code)) || lower.includes(code.toString(16)) ||
			source.includes(String(code)) || lower.includes(encodeURIComponent(String.fromCharCode(code)).toLowerCase()))) code++;
		if (code > 0xf8ff) throw new Error('No unused math source marker');
		return String.fromCharCode(code++);
	};
}
