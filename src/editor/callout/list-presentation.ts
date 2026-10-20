import type { EditorState } from '@codemirror/state';
import { decorationsFor, projectionEntries, taskDecorationsFor, type ProjectionEntry } from '../structured-list/projection.js';
import { Decoration, type DecorationSet } from '@codemirror/view';
import type { SourceRange } from '../structured-list/model.js';
import { quoteContainers, type CalloutCard } from './presentation-model.js';
import { projectQuoteContent, quotePrefix } from './projection.js';
import { discoverMath } from '../math/syntax.js';
import { mapListBlankRuns } from '../structured-list/blank-runs.js';

const cache = new WeakMap<EditorState, ReadonlyMap<CalloutCard, readonly ProjectionEntry[]>>();

function entriesForCard(state: EditorState, card: CalloutCard): readonly ProjectionEntry[] {
	const first = card.kind === 'callout' ? card.headerTo + 1 : card.from;
	const content = projectQuoteContent(state, first, card.to, card.depth);
	if (!content) return [];
	const mapRange = (range: SourceRange): SourceRange => ({ from: content.toSource(range.from), to: content.toSource(range.to) });
	const physicalRange = (range: SourceRange): SourceRange => ({ ...mapRange(range), from: state.doc.lineAt(content.toSource(range.from)).from });
	const math = discoverMath(state).filter(expression => expression.display);
	const mathLine = (from: number) => math.some(expression => state.doc.lineAt(expression.from).from <= from && from < expression.to);
	return projectionEntries(content.state, undefined, lineFrom =>
		quotePrefix(state.doc.lineAt(content.toSource(lineFrom)).text, card.depth + 1) === null).map(entry => ({
		...entry,
		blankRuns: entry.blankRuns && mapListBlankRuns(entry.blankRuns,at=>content.toSource(at),at=>state.doc.lineAt(content.toSource(at)).from)
			.filter(run => !run.rows.some(row => mathLine(row.at))),
		item: physicalRange(entry.item),
		prefix: physicalRange(entry.prefix),
		replacement: mapRange(entry.replacement),
		collapsedSeparator: entry.collapsedSeparator ? mapRange(entry.collapsedSeparator) : null,
		taskToken: entry.taskToken ? mapRange(entry.taskToken) : null,
		ownedLines: entry.ownedLines.map(line => ({ ...line, range: physicalRange(line.range), prefix: physicalRange(line.prefix) }))
			.filter(line => !mathLine(line.range.from)),
	}));
}

export function calloutListEntries(state: EditorState, cards: readonly CalloutCard[] = quoteContainers(state)): readonly ProjectionEntry[] {
	let byCard = cache.get(state);
	if (!byCard) {
		byCard = new Map(quoteContainers(state).map(card => [card, entriesForCard(state, card)]));
		cache.set(state, byCard);
	}
	return cards.flatMap(card => byCard.get(card)!);
}

/** Only container indentation is removed here; marker and task rendering are shared. */
export function calloutListDecorations(state: EditorState, entries: readonly ProjectionEntry[]): DecorationSet {
	const ranges = entries.flatMap(entry => {
		const source = state.doc.lineAt(entry.prefix.from);
		let depth = 0;
		while (quotePrefix(source.text, depth + 1) !== null) depth += 1;
		const indentFrom = entry.prefix.from + quotePrefix(source.text, depth)!.length;
		return [
			Decoration.line({ class: `HyperMD-list-line HyperMD-list-line-${entry.marker.depth + 1}${entry.taskToken ? ' HyperMD-task-line' : ''}`,
				attributes: { style: `--paraflow-list-depth:${entry.marker.depth}`,
					...(entry.taskToken ? { 'data-task': state.sliceDoc(entry.taskToken.from + 1, entry.taskToken.from + 2).toLowerCase() } : {}) } }).range(entry.prefix.from),
			...(indentFrom < entry.replacement.from ? [Decoration.replace({}).range(indentFrom, entry.replacement.from)] : []),
		];
	});
	for (const decorations of [decorationsFor(entries), taskDecorationsFor(state, entries)]) {
		decorations.between(0, state.doc.length, (from, to, decoration) => { ranges.push(decoration.range(from, to)); });
	}
	return Decoration.set(ranges, true);
}
