import { EditorSelection, EditorState, RangeSet, RangeValue, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { getParagraphProjectionState } from '../paragraph/projection.js';
import { classifyCurrentSelectionMode, compositionStateField, excludedSelectionModeForTransaction, recognizedNormalSelectionTransaction } from '../runtime/input-state.js';
import { createVisualNavigationAdapter, requireGoalXStore } from '../runtime/navigation-core.js';
import { quoteContainers } from './presentation-model.js';
import { projectQuoteContent, quotePrefix } from './projection.js';
import { calloutListEntries } from './list-presentation.js';
import { paragraphGapTags } from '../paragraph/model.js';
import {emptyBodies} from '../runtime/empty-body-state.js';

interface Gap { readonly from: number; readonly to: number; readonly before?: string; readonly after?: string; readonly edge?: 'leading' | 'trailing' }
const cache = new WeakMap<EditorState, readonly Gap[]>();
class GapRange extends RangeValue {}
const atomic = new GapRange();

/** Reuse paragraph ownership in the stripped body, then map both endpoints through quote prefixes. */
export function calloutGaps(state: EditorState): readonly Gap[] {
	const previous = cache.get(state);
	if (previous) return previous;
	const gaps = new Map<number, Gap>();
	for (const card of quoteContainers(state)) {
		const listEntries = calloutListEntries(state, [card]);
		const contentBoundary = (position: number): number => listEntries.find(entry =>
			entry.prefix.from <= position && position < entry.prefix.to)?.prefix.to ?? position;
		const first = state.doc.lineAt(card.from).number + (card.kind === 'callout' ? 1 : 0);
		const last = state.doc.lineAt(card.to).number;
		if (first > last) continue;
		const line = state.doc.line(first);
		const prefix = quotePrefix(line.text, card.depth);
		if (prefix === null) continue;
		const projection = projectQuoteContent(state, line.from, state.doc.line(last).to, card.depth);
		if (!projection || projection.depth !== card.depth) continue;
		const paragraph = getParagraphProjectionState(projection.state)!;
		const drafts = emptyBodies(projection.state);
		for (const gap of paragraph.rangeIndex.gaps) {
			const leading = gap.from === 0 && !paragraph.authority.runs.some(run => run.editableAnchors.includes(0));
			const from = leading ? card.kind === 'callout' ? card.headerTo : line.from : projection.toSource(gap.from);
			const end = projection.toSource(gap.to);
			const run = paragraph.authority.runs.find(run => run.gaps.some(candidate => candidate.from === gap.from && candidate.to === gap.to))!;
			const { before, after } = paragraphGapTags(paragraph.authority.blocks, run)(gap.from);
			gaps.set(from, { from, to: contentBoundary(end), before, after,
				...(leading ? {edge:'leading' as const} : {}) });
		}
		// A single terminal separator folds; longer runs retain ordinary empty bodies.
		const tail = paragraph.authority.runs.find(run => run.kind === 'trailing' && !run.gaps.length);
		if (tail && !drafts.includes(tail.to)) {
			const from = projection.toSource(tail.from);
			gaps.set(from, {from,to:projection.toSource(tail.to),edge:'trailing'});
		}
	}
	const result = [...gaps.values()].sort((a, b) => a.from - b.from);
	cache.set(state, result);
	return result;
}

export function moveAcrossCalloutGap(view: EditorView, forward: boolean): boolean {
	if (view.composing || view.state.field(compositionStateField, false) ||
		classifyCurrentSelectionMode(view.state) !== 'caret') return false;
	const current = view.state.selection.main;
	if (!quoteContainers(view.state).some(card => card.from <= current.head && current.head <= card.to)) return false;
	const gaps = calloutGaps(view.state);
	if (!gaps.length) return false;
	const visual = createVisualNavigationAdapter(view);
	const store = requireGoalXStore(view);
	const start = { position: current.head, assoc: current.assoc };
	const goalX = store.read() ?? current.goalColumn ?? visual.coordsAtPos(start)?.left;
	if (goalX === undefined) return false;
	const candidate = visual.moveVertically(start, forward, goalX);
	const from = Math.min(current.head, candidate.position), to = Math.max(current.head, candidate.position);
	const gap = gaps.find(gap => !gap.edge && from <= gap.from && gap.to <= to);
	const destination = forward ? gap?.after : gap?.before;
	const origin = forward ? gap?.before : gap?.after;
	// Code, math and other rich blocks retain their own entry and editing sessions.
	if ((destination !== 'p' && destination !== 'list-item') ||
		(origin !== 'p' && origin !== 'list-item')) return false;
	// Atomic gaps snap to a body edge; recover the original visual column on that row.
	const aligned = visual.alignGoalOnVisualLine!({ position: candidate.position, assoc: forward ? 1 : -1 }, goalX);
	view.dispatch({ selection: EditorSelection.cursor(aligned.position, aligned.assoc, undefined, goalX),
		userEvent: 'move.line', scrollIntoView: true });
	store.write(goalX);
	return true;
}

export function createCalloutGapProtection(isActive: (view: EditorView) => boolean): Extension {
	const views = new Set<EditorView>();
	return [ViewPlugin.fromClass(class {
		constructor(readonly view: EditorView) { views.add(view); }
		destroy(): void { views.delete(this.view); }
	}), EditorView.atomicRanges.of(view => isActive(view)
		? RangeSet.of(calloutGaps(view.state).map(gap => atomic.range(gap.from, gap.to)), true) : RangeSet.empty),
	EditorState.transactionFilter.of(transaction => {
		const owners = [...views].filter(view => view.state === transaction.startState);
		if (!owners.length || owners.some(view => !isActive(view) || view.composing) ||
			transaction.startState.field(compositionStateField, false) || transaction.state.field(compositionStateField, false) ||
			transaction.newSelection.ranges.length !== 1 || excludedSelectionModeForTransaction(transaction) !== null ||
			!(recognizedNormalSelectionTransaction(transaction) || transaction.isUserEvent('move.character') || transaction.isUserEvent('move.line'))) return transaction;
		const selection = transaction.newSelection.main;
		if (selection.from === 0 && selection.to === transaction.newDoc.length) return transaction;
		const gaps = calloutGaps(transaction.state);
		const normalize = (position: number, bias: -1 | 1): number => {
			const edge = gaps.find(gap => gap.edge === 'leading' ? gap.from <= position && position < gap.to :
				gap.edge === 'trailing' && gap.from < position && position <= gap.to);
			if (edge) return edge.edge === 'leading' ? edge.to : edge.from;
			const gap = gaps.find(gap => gap.from < position && position < gap.to);
			if (!gap) return position;
			if (selection.empty && transaction.isUserEvent('select.pointer')) return position - gap.from < gap.to - position ? gap.from : gap.to;
			return bias < 0 ? gap.from : gap.to;
		};
		const direction = selection.empty ? (selection.head < transaction.startState.selection.main.head ? -1 : 1) : selection.anchor < selection.head ? 1 : -1;
		const anchor = normalize(selection.anchor, direction);
		const head = selection.empty ? anchor : normalize(selection.head, direction === 1 ? -1 : 1);
		if (anchor === selection.anchor && head === selection.head) return transaction;
		return [transaction, { selection: EditorSelection.create([selection.empty
			? EditorSelection.cursor(head, direction, selection.bidiLevel ?? undefined, selection.goalColumn)
			: EditorSelection.range(anchor, head, selection.goalColumn, selection.bidiLevel ?? undefined)]), sequential: true }];
	})];
}
