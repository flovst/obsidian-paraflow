import type { ParagraphPhysicalRow } from './model.js';

/** Physical blank rows shared by editable and reading projections. */
export function middleBlankRows(from: number, newlineCount: number): readonly ParagraphPhysicalRow[] {
	return Array.from({ length: Math.max(0, newlineCount - 1) }, (_, index) => {
		const row = index + 1;
		return { at: from + row, kind: newlineCount % 2 === 1 && row === newlineCount - 1
			? 'folded' : row % 2 === 1 ? 'gap-head' : 'editable' };
	});
}
