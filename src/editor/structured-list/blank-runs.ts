import type { ParagraphPhysicalRow } from '../paragraph/model.js';
import type { ProjectionOwnedLine, SourceRange } from './model.js';
import type { SourceAnalysis } from './context-analysis.js';

interface BlankRunOwner {
	readonly item: SourceRange;
	readonly prefix: SourceRange;
	readonly ownedLines: readonly ProjectionOwnedLine[];
	readonly blankRuns?: readonly ListBlankRun[];
}

export interface ListBlankRun {
	readonly range: SourceRange;
	readonly rows: readonly ParagraphPhysicalRow[];
	readonly editableBodies: readonly SourceRange[];
	readonly transparentRanges: readonly SourceRange[];
}

function runFor(lines: readonly ProjectionOwnedLine[], created: ReadonlySet<number> = new Set()): ListBlankRun {
	const first = lines[0]!, last = lines.at(-1)!;
	const staticCount = lines.filter(line=>!created.has(line.range.from)).length;
	let staticIndex = 0;
	const rows = lines.map(line => {
		if (created.has(line.range.from)) return {at:line.range.from,kind:'editable' as const};
		const index = staticIndex++;
		return {at:line.range.from,kind:staticCount % 2 === 0 && index === staticCount-1 ? 'folded' as const :
			index % 2 === 0 ? 'gap-head' as const : 'editable' as const};
	});
	const editableBodies = lines.filter((_,index)=>rows[index]!.kind==='editable')
		.map(line=>({from:line.prefix.to,to:line.range.to}));
	const transparentRanges: SourceRange[] = [];
	let from = first.range.from - 1;
	for (const body of editableBodies) {
		transparentRanges.push({ from, to: body.from });
		from = body.to;
	}
	transparentRanges.push({ from, to: last.range.to + 1 });
	return {
		range: { from: first.range.from - 1, to: last.range.to + 1 },
		rows,
		editableBodies, transparentRanges,
	};
}

/** Source-backed list whitespace uses the same gap/body rhythm as ordinary paragraphs. */
export function listBlankRuns(entries: readonly BlankRunOwner[]): readonly ListBlankRun[] {
	return entries.flatMap(entry => {
		if (entry.blankRuns) return entry.blankRuns;
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
		}).map(lines => runFor(lines));
	});
}

/** Complete physical runs may end one bare row beyond the syntax item's last token. */
export function sourceListBlankRuns(analysis: Pick<SourceAnalysis, 'items' | 'lines' | 'source'>): readonly { ownerFrom: number; run: ListBlankRun }[] {
	const groups: (typeof analysis.lines[number])[][] = [];
	for (const line of analysis.lines) {
		if (line.whitespaceKind === null || line.codeLeaf || line.mathLeaf || line.text.includes('\u200b')) continue;
		const group = groups.at(-1);
		if (group?.at(-1)!.to === line.from - 1) group.push(line);
		else groups.push([line]);
	}
	return groups.flatMap(lines => {
		if (lines.every(line=>line.createdEmptyBody)) return [];
		const first = lines[0]!, last = lines.at(-1)!;
		const owner = analysis.items.filter(item => lines.some(line =>
			item.line.from < line.from && line.from < item.block.item.to))
			.sort((left,right) => right.depth-left.depth || left.block.item.to-right.block.item.to)[0];
		if (!owner || first.from === 0 || !(owner.block.item.to > last.to ||
			analysis.items.some(item => item.line.from === last.to + 1))) return [];
		return [{ownerFrom:owner.line.from,run:runFor(lines.map(line => ({
			depth:owner.depth,kind:'blank',ownerKind:owner.block.prefix.kind,
			prefix:{from:line.from,to:line.from+line.indentText.length},
			range:{from:line.from,to:line.to},rendering:owner.depth<6?'projected':'native-depth',
		})),new Set(lines.filter(line=>line.createdEmptyBody).map(line=>line.from)))}];
	});
}

export function mapListBlankRuns(runs: readonly ListBlankRun[], position: (at:number)=>number, rowPosition=position): readonly ListBlankRun[] {
	const range=(value:SourceRange)=>({from:position(value.from),to:position(value.to)});
	return runs.map(run=>({range:range(run.range),rows:run.rows.map(row=>({...row,at:rowPosition(row.at)})),
		editableBodies:run.editableBodies.map(range),transparentRanges:run.transparentRanges.map(range)}));
}
