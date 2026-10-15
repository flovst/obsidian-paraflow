import type { ParagraphPhysicalRow } from '../paragraph/model.js';
import type { ProjectionOwnedLine, SourceRange } from './model.js';

interface BlankRunOwner {
	readonly item: SourceRange;
	readonly prefix: SourceRange;
	readonly ownedLines: readonly ProjectionOwnedLine[];
}

export interface ListBlankRun {
	readonly range: SourceRange;
	readonly rows: readonly ParagraphPhysicalRow[];
	readonly editableBodies: readonly SourceRange[];
	readonly transparentRanges: readonly SourceRange[];
}

function runFor(lines: readonly ProjectionOwnedLine[]): ListBlankRun {
	const first = lines[0]!, last = lines.at(-1)!;
	const editableBodies = lines.filter((_, index) => index % 2 === 1 &&
		!(lines.length % 2 === 0 && index === lines.length - 1)).map(line => ({from:line.prefix.to,to:line.range.to}));
	const transparentRanges: SourceRange[] = [];
	let from = first.range.from - 1;
	for (const body of editableBodies) {
		transparentRanges.push({ from, to: body.from });
		from = body.to;
	}
	transparentRanges.push({ from, to: last.range.to + 1 });
	return {
		range: { from: first.range.from - 1, to: last.range.to + 1 },
		rows: lines.map((line, index) => ({ at: line.range.from,
			kind: lines.length % 2 === 0 && index === lines.length - 1 ? 'folded' :
				index % 2 === 0 ? 'gap-head' : 'editable' })),
		editableBodies, transparentRanges,
	};
}

/** Source-backed list whitespace uses the same gap/body rhythm as ordinary paragraphs. */
export function listBlankRuns(entries: readonly BlankRunOwner[]): readonly ListBlankRun[] {
	return entries.flatMap(entry => {
		const groups: ProjectionOwnedLine[][] = [];
		for (const line of entry.ownedLines.filter(line => line.kind === 'blank')) {
			const group = groups.at(-1);
			if (group?.at(-1)!.range.to === line.range.from - 1) group.push(line);
			else groups.push([line]);
		}
		return groups.filter(group => {
			const first = group[0]!, last = group.at(-1)!;
			return first.range.from > 0 && (entry.item.to > last.range.to ||
				entries.some(next => next.prefix.from === last.range.to + 1));
		}).map(runFor);
	});
}
