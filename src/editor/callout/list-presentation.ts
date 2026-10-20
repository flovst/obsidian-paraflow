import type { EditorState } from '@codemirror/state';
import { decorationsFor, projectionEntries, taskDecorationsFor, type ProjectionEntry } from '../structured-list/projection.js';
import { Decoration, type DecorationSet } from '@codemirror/view';
import type { SourceRange } from '../structured-list/model.js';
import { quoteContainers, type CalloutCard } from './presentation-model.js';
import { projectQuoteContent, quotePrefix } from './projection.js';
import { discoverMath } from '../math/syntax.js';
import { mapListBlankRuns } from '../structured-list/blank-runs.js';

interface ListContext {
	readonly byCard: Map<CalloutCard, readonly ProjectionEntry[]>;
	displayMath?: readonly SourceRange[];
}
const cache = new WeakMap<EditorState, ListContext>();

function entriesForCard(state: EditorState, card: CalloutCard, context: ListContext): readonly ProjectionEntry[] {
	const first = card.kind === 'callout' ? card.headerTo + 1 : card.from;
	const content = projectQuoteContent(state, first, card.to, card.depth);
	if (!content) return [];
	const mapRange = (range: SourceRange): SourceRange => ({ from: content.toSource(range.from), to: content.toSource(range.to) });
	const physicalRange = (range: SourceRange): SourceRange => ({ ...mapRange(range), from: state.doc.lineAt(content.toSource(range.from)).from });
	const entries = projectionEntries(content.state, undefined, lineFrom =>
		quotePrefix(state.doc.lineAt(content.toSource(lineFrom)).text, card.depth + 1) === null);
	if (!entries.length) return [];
	// All cards in this state share one outer discovery and one line-boundary conversion.
	const math = context.displayMath ??= discoverMath(state).filter(expression => expression.display)
		.map(expression => ({ from: state.doc.lineAt(expression.from).from, to: expression.to }));
	const mathLine = (from: number) => math.some(expression => expression.from <= from && from < expression.to);
	return entries.map(entry => ({
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
	let context = cache.get(state);
	if (!context) {
		context = { byCard: new Map() };
		cache.set(state, context);
	}
	const { byCard } = context;
	return cards.flatMap(card => {
		let entries = byCard.get(card);
		if (!entries) {
			entries = entriesForCard(state, card, context);
			byCard.set(card, entries);
		}
		return entries;
	});
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
