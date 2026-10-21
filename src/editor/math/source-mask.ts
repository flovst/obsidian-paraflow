export function maskMathSource(source: string, masks: readonly { readonly from: number; readonly to: number }[], fill: 'x' | ' ' = 'x'): string {
	let result = '', from = 0;
	for (const mask of masks) {
		result += source.slice(from, mask.from) + source.slice(mask.from, mask.to).split('\n').map((line, index) => {
			const prefix = index ? /^[ \t]*(?:>[ \t]*)*/u.exec(line)![0] : '';
			return prefix + line.slice(prefix.length).replace(/[^\r]/g, fill);
		}).join('\n');
		from = mask.to;
	}
	return result + source.slice(from);
}
