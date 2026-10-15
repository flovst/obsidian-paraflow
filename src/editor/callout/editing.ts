import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { ChangeSet, EditorSelection, EditorState, findClusterBreak, Transaction, type TransactionSpec } from '@codemirror/state';
import { buildListContext, buildSelectionContext } from '../structured-list/context.js';
import { planSelectionIndent } from '../structured-list/selection-indent.js';
import { createEditScope, validateEditPlan, type EditPlan } from '../structured-list/edit-plan.js';
import type { ContextRuntime } from '../structured-list/model.js';
import { executeRegisteredOperation, type StructuralOperationId } from '../structured-list/operations.js';
import { prefixPolicy } from '../structured-list/prefix.js';
import { composeEditPlan, createSelectionCutPlan, remapIndentation, renumberOrderedItems } from '../structured-list/primitives.js';
import { enumerateListItems } from '../structured-list/syntax.js';
import { planGapDeletion, planParagraphEnter } from '../paragraph/operations.js';
import { adaptParagraphBlockGap, validateParagraphEditPlan } from '../paragraph/edit-plan.js';
import { codeMarkersActive } from '../code-blocks/editable-boundaries.js';
import { requireParagraphProjectionState } from '../paragraph/projection.js';
import { ordinaryParagraphAtCaret } from '../paragraph/syntax.js';
import { projectCallout, quotePrefix, type CalloutProjection } from './projection.js';
import { hasNativeOwnership } from './syntax.js';
import {quoteContainers} from './presentation-model.js';
import {emptyBodies,registerEmptyBody} from '../runtime/empty-body-state.js';

export type CalloutKey = 'Enter' | 'Shift-Enter' | 'Tab' | 'Shift-Tab' | 'Backspace' | 'Delete';

/** Empty container deletion owns both the visible body and its hidden source prefix. */
export function planEmptyCalloutBackspace(state: EditorState): TransactionSpec | null {
	if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
	const head = state.selection.main.head;
	const card = quoteContainers(state).filter(card => card.from <= head && head <= card.to)
		.sort((a, b) => b.depth - a.depth)[0];
	if (!card) return null;
	const first = state.doc.lineAt(card.from), last = state.doc.lineAt(card.to);
	if (card.kind === 'callout' && !/^\[![^\]]+\][+-]?[ \t]*$/u.test(card.header)) return null;
	for (let number = first.number + (card.kind === 'callout' ? 1 : 0); number <= last.number; number++) {
		const line = state.doc.line(number), prefix = quotePrefix(line.text, card.depth);
		if (prefix === null || line.text.slice(prefix.length).trim() !== '') return null;
	}
	const prefix = quotePrefix(first.text, card.depth)!;
	const outer = prefix.slice(0, prefix.lastIndexOf('>'));
	const anchor = first.from + outer.length;
	return {...transaction({from:first.from,to:card.to,insert:outer},EditorSelection.single(anchor)),
		effects:registerEmptyBody.of(anchor)};
}

export function planCalloutInput(state: EditorState, from: number, to: number, text: string): TransactionSpec | null {
	if (state.selection.ranges.length !== 1 || from === to && !text.includes('\n')) return null;
	const selected = state.update({ selection: EditorSelection.single(from, to) }).state;
	const projection = projectCallout(selected);
	if (!projection) return null;
	const virtual = projection.state;
	const selection = virtual.selection.main;
	if (hasNativeOwnership(syntaxTree(virtual), selection.from, selection.to)) return null;
	let nested = false;
	syntaxTree(virtual).iterate({ from: selection.from, to: selection.to, enter(node) { if (node.name === 'Blockquote') nested = true; } });
	if (nested) return null;
	const context = selection.empty ? null : buildSelectionContext(virtual, virtual.selection, { operation: 'normal-selection',
		editIntent: 'cut', imeComposing: false, selectionMode: 'continuous', selectionsCount: 1 });
	const cut = context ? createSelectionCutPlan(context) : null;
	if (context && !cut) return null;
	const protectedRanges = enumerateListItems(virtual).map(item => item.prefix.full);
	const id = { kind: 'selection-start-content' as const, index: null };
	const scope = context?.editScope ?? createEditScope('normal-selection', 'editable', [{ id,
		range: { from: selection.from, to: selection.to }, protection: 'ordinary' }], virtual.doc.length);
	if (!cut && protectedRanges.some(range => range.from < selection.to && range.to > selection.from)) return null;
	let changes = ChangeSet.of(cut?.changes ?? [{ from: selection.from, to: selection.to, insert: '' }], virtual.doc.length);
	const caret = cut?.selection?.main.head ?? selection.from;
	if (cut) validateEditPlan(virtual.doc.toString(), cut, { expectedOperation: 'normal-selection', expectedScope: scope,
		authoritativeProtectedRanges: protectedRanges });
	const afterCut = virtual.update({ changes, selection: EditorSelection.single(caret) }).state;
	const insertionScope = createEditScope('normal-selection', 'editable', [{ id, range: { from: caret, to: caret }, protection: 'ordinary' }], afterCut.doc.length);
	if (text.length > 0) validateEditPlan(afterCut.doc.toString(), { changes: [{ from: caret, insert: text }], selection: EditorSelection.single(caret + text.length),
		ownership: { regionIds: [id] }, exceptionId: null }, { expectedOperation: 'normal-selection', expectedScope: insertionScope,
		authoritativeProtectedRanges: enumerateListItems(afterCut).map(item => item.prefix.full) });
	changes = changes.compose(ChangeSet.of({ from: caret, insert: text }, changes.newLength));
	const plan: EditPlan = { changes: [changes], selection: EditorSelection.single(caret + text.length),
		ownership: cut?.ownership ?? { regionIds: [id] }, exceptionId: cut?.exceptionId ?? null };
	if (!cut) validateEditPlan(virtual.doc.toString(), plan, { expectedOperation: 'normal-selection', expectedScope: scope,
		authoritativeProtectedRanges: protectedRanges });
	return mapCalloutPlan(state, projection, plan);
}

const operations: Readonly<Record<CalloutKey, readonly StructuralOperationId[]>> = {
	Enter: ['enter-task-non-empty', 'enter-non-empty', 'enter-empty-nested', 'enter-empty-top-level'],
	'Shift-Enter': ['shift-enter'],
	Tab: ['tab'],
	'Shift-Tab': ['shift-tab'],
	Backspace: ['backspace-empty-nested', 'backspace-empty-top-level', 'backspace-nested-content-start',
		'backspace-top-level-content-start', 'backspace-delete-inside-content'],
	Delete: ['backspace-delete-inside-content'],
};

function transaction(changes: TransactionSpec['changes'], selection: EditorSelection): TransactionSpec {
	return { changes, selection, scrollIntoView: true,
		annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')] };
}

export function mapCalloutPlan(source: EditorState, projection: CalloutProjection, plan: EditPlan): TransactionSpec {
	const virtualChanges = ChangeSet.of(plan.changes, projection.state.doc.length);
	const virtual = projection.state.update({ changes: virtualChanges, selection: plan.selection ?? undefined }).state;
	const changes: { from: number; to: number; insert: string }[] = [];
	virtualChanges.iterChanges((from, to, _newFrom, _newTo, insert) => {
		const line = projection.state.doc.lineAt(from);
		const prefix = projection.lines[line.number - 1]!.prefix;
		const continuation = quotePrefix(prefix, projection.depth) !== null ? prefix :
			projection.lines.find(row => row.text.trim() && quotePrefix(row.prefix, projection.depth) !== null)?.prefix ?? '> '.repeat(projection.depth);
		const parts = insert.toString().split('\n');
		const suffix = projection.state.sliceDoc(to, projection.state.doc.lineAt(to).to);
		let body = parts.map((part, index) => {
			const next = part || (index === parts.length - 1 ? suffix : '');
			const actualPrefix = index === 0 ? prefix : continuation;
			const separator = actualPrefix.endsWith('>') && /^[ \t]/u.test(next) ? ' ' : '';
			return index === 0 ? (from === line.from ? separator : '') + part : continuation + separator + part;
		}).join('\n');
		let sourceFrom = projection.toSource(from);
		if (quotePrefix(prefix, projection.depth) === null &&
			virtual.doc.lineAt(virtualChanges.mapPos(line.from, -1)).text.trim() === '') {
			// An empty physical line cannot remain a lazy continuation.
			sourceFrom = projection.lines[line.number - 1]!.from;
			body = continuation + projection.state.sliceDoc(line.from, from) + body;
		}
		changes.push({ from: sourceFrom, to: projection.toSource(to), insert: body });
	});
	const next = ChangeSet.of(changes, source.doc.length).apply(source.doc);
	const firstNumber = source.doc.lineAt(projection.lines[0]!.from).number;
	function map(position: number): number {
		const virtualLine = virtual.doc.lineAt(position);
		const sourceLine = next.line(firstNumber + virtualLine.number - 1);
		// Both documents share the edited body; the physical line additionally owns its original or generated prefix.
		const prefixLength = sourceLine.length - virtualLine.length;
		if (prefixLength < 0) throw new Error('Callout operation lost its body mapping');
		return sourceLine.from + prefixLength + position - virtualLine.from;
	}
	const selected = virtual.selection.main;
	const mappedSelection = selected.empty
		? EditorSelection.cursor(map(selected.head), selected.assoc, selected.bidiLevel ?? undefined, selected.goalColumn)
		: EditorSelection.range(map(selected.anchor), map(selected.head), selected.goalColumn, selected.bidiLevel ?? undefined);
	return transaction(changes, EditorSelection.create([mappedSelection]));
}

function emptyParagraph(projection: CalloutProjection): TransactionSpec | null {
	const virtual = projection.state;
	const line = virtual.doc.lineAt(virtual.selection.main.head);
	if (line.text.trim() !== '') return null;
	const original = projection.lines[line.number - 1]!;
	const outer = original.prefix.slice(0, original.prefix.lastIndexOf('>'));
	const anchor = original.from + outer.length;
	const trailing = requireParagraphProjectionState(virtual).authority.runs.find(run =>
		run.kind === 'trailing' && run.from < line.from && line.to <= run.to);
	// Tail separators belong to the exiting body, unless a later explicit body owns them.
	const end = trailing && !emptyBodies(virtual).some(body => line.to < body && body <= trailing.to)
		? projection.lines.length : line.number;
	const changes = projection.lines.slice(line.number - 1, end).map(row => ({
		from: row.from + row.prefix.lastIndexOf('>'),
		to: row.from + row.prefix.length + row.text.length,
		insert: '',
	}));
	return { ...transaction(changes,
		EditorSelection.single(anchor)), effects: registerEmptyBody.of(anchor) };
}

function subtreeIndent(context: NonNullable<ReturnType<typeof buildListContext>>): EditPlan | null {
	if (context.topology.ownedBlocks.length === 0) return null;
	const previous = context.topology.previousSibling;
	if (!previous) return null;
	const delta = previous.prefix.outerMarker.to - previous.lineFrom -
		(context.current.prefix.outerMarker.from - context.current.lineFrom);
	if (delta <= 0) return null;
	const ids = [{ kind: 'current-item' as const, index: null },
		...context.topology.ownedBlocks.map((_block, index) => ({ kind: 'owned-block' as const, index }))];
	const plan = composeEditPlan('tab', context.editScope, [remapIndentation(context.source, context.editScope, ids, delta)]);
	return { ...plan, selection: EditorSelection.single(ChangeSet.of(plan.changes, context.source.length).mapPos(context.caret)) };
}

function runtime(operation: StructuralOperationId): ContextRuntime {
	return { operation, editIntent: 'structural', imeComposing: false, selectionMode: 'caret', selectionsCount: 1 };
}

function planListStructural(virtual: EditorState, key: CalloutKey): EditPlan | null {
	for (const operation of operations[key]) {
		const context = buildListContext(virtual, virtual.selection.main.head, runtime(operation));
		if (!context) return null;
		if (context.current.lineFrom !== virtual.doc.lineAt(virtual.selection.main.head).from &&
			!((key === 'Tab' || key === 'Shift-Tab') && context.caretContent.kind !== 'marker-line')) return continuationPlan(virtual, key, context);
		let hasNestedQuote = false;
		syntaxTree(virtual).iterate({ from: context.current.item.from, to: context.current.item.to,
			enter(node) { if (node.name === 'Blockquote') hasNestedQuote = true; } });
		if (hasNestedQuote && (key === 'Tab' || key === 'Shift-Tab')) return null;
		const subtree = key === 'Tab' && context.caretContent.kind === 'marker-line' ? subtreeIndent(context) : null;
		const result = subtree ? { kind: 'edit' as const, plan: subtree } : executeRegisteredOperation({ context,
			intent: { family: 'structural', operation,
				direction: key === 'Backspace' ? 'backward' : key === 'Delete' ? 'forward' : null },
			services: { prefixPolicy } });
		if (result.kind !== 'edit') continue;
		validateEditPlan(virtual.doc.toString(), result.plan, {
			expectedOperation: operation, expectedScope: context.editScope,
			authoritativeProtectedRanges: enumerateListItems(virtual).map((item) => item.prefix.full),
		});
		return result.plan;
	}
	return null;
}

function continuationPlan(state: EditorState, key: CalloutKey,
	context: NonNullable<ReturnType<typeof buildListContext>>): EditPlan | null {
	const caret = state.selection.main.head;
	let paragraph = false;
	for (let node = syntaxTree(state).resolveInner(caret, -1); node.parent; node = node.parent) {
		if (node.name === 'Paragraph') paragraph = true;
		if (node.name === 'ListItem') break;
	}
	if (!paragraph) return null;
	if (key === 'Backspace' || key === 'Delete') return continuationDelete(state, key, context);
	if (key !== 'Enter' && key !== 'Shift-Enter') return null;
	const line = state.doc.lineAt(caret);
	const indent = /^[ \t]*/u.exec(line.text)![0];
	const owner = context.current;
	const prefix = key === 'Shift-Enter' ? indent : state.sliceDoc(owner.lineFrom, owner.prefix.full.from) +
		prefixPolicy.renderSameLevel(owner.prefix, { taskState: ' ', ...(owner.prefix.orderedValue === null ? {} : {
			orderedValue: (context.topology.orderedSequence?.renderedValue ?? owner.prefix.orderedValue) + 1,
		}) });
	const insert = `\n${prefix}`;
	const id = { kind: 'owned-block' as const, index: 0 };
	const operation = key === 'Shift-Enter' ? 'shift-enter' : 'enter-non-empty';
	const sequence = key === 'Enter' ? context.topology.orderedSequence : null;
	const following = sequence?.items.flatMap((item, index) => index > sequence.currentIndex ? [{
		id: { kind: 'ordered-sequence-item' as const, index }, range: item.prefix.full, protection: 'protected-prefix' as const,
	}] : []) ?? [];
	const scope = createEditScope(operation, 'editable', [{ id, range: { from: line.from + indent.length, to: line.to },
		protection: 'ordinary' }, ...following], state.doc.length);
	const numbered = sequence && following.length ? renumberOrderedItems(context.source, scope,
		following.map((region) => region.id), sequence, 1).changes : [];
	const changes = ChangeSet.of([{ from: caret, insert }, ...numbered], state.doc.length);
	const plan: EditPlan = { changes: [changes], selection: EditorSelection.single(caret + insert.length),
		ownership: { regionIds: scope.regionIds }, exceptionId: null };
	validateEditPlan(state.doc.toString(), plan, { expectedOperation: operation, expectedScope: scope,
		authoritativeProtectedRanges: enumerateListItems(state).map((item) => item.prefix.full) });
	return plan;
}

function continuationDelete(state: EditorState, key: 'Backspace' | 'Delete',
	context: NonNullable<ReturnType<typeof buildListContext>>): EditPlan | null {
	const caret = state.selection.main.head;
	const line = state.doc.lineAt(caret);
	const start = line.from + /^[ \t]*/u.exec(line.text)![0].length;
	let from: number;
	let to: number;
	let kind: 'current-content' | 'structural-boundary' = 'current-content';
	if (key === 'Backspace' && caret > start) {
		from = line.from + findClusterBreak(line.text, caret - line.from, false); to = caret;
	} else if (key === 'Delete' && caret < line.to) {
		from = caret; to = line.from + findClusterBreak(line.text, caret - line.from, true);
	} else if (key === 'Backspace' && caret === start && line.number > 1) {
		const previous = state.doc.line(line.number - 1);
		if (previous.from < context.current.lineFrom) return null;
		from = previous.to; to = start; kind = 'structural-boundary';
	} else if (key === 'Delete' && caret === line.to && line.number < state.doc.lines) {
		const next = state.doc.line(line.number + 1);
		if (next.to > context.current.item.to || prefixPolicy.parse(next.text, next.from)) return null;
		from = caret; to = next.from + /^[ \t]*/u.exec(next.text)![0].length; kind = 'structural-boundary';
	} else return null;
	if (hasNativeOwnership(syntaxTree(state), from, to)) return null;
	const id = { kind, index: null };
	const scope = createEditScope('backspace-delete-inside-content', 'editable', [{
		id, range: { from, to }, protection: 'ordinary',
	}], state.doc.length);
	const plan: EditPlan = { changes: [{ from, to, insert: '' }], selection: EditorSelection.single(from),
		ownership: { regionIds: [id] }, exceptionId: null };
	validateEditPlan(state.doc.toString(), plan, { expectedOperation: 'backspace-delete-inside-content', expectedScope: scope,
		authoritativeProtectedRanges: enumerateListItems(state).map((item) => item.prefix.full) });
	return plan;
}

function selectionIndent(projection: CalloutProjection, key: 'Tab' | 'Shift-Tab'): EditPlan | null {
	const operation = key === 'Tab' ? 'tab' : 'shift-tab';
	const planned = planSelectionIndent(projection.state, operation, {
		operation, editIntent: 'structural', imeComposing: false, selectionMode: 'continuous', selectionsCount: 1,
	}, prefixPolicy);
	return planned?.result.kind === 'edit' ? planned.result.plan : null;
}

function selectionKey(source: EditorState, projection: CalloutProjection, key: CalloutKey): TransactionSpec | null {
	if (key === 'Tab' || key === 'Shift-Tab') {
		const plan = selectionIndent(projection, key);
		return plan ? mapCalloutPlan(source, projection, plan) : null;
	}
	if (key !== 'Enter' && key !== 'Shift-Enter') return null;
	const virtual = projection.state;
	const context = buildSelectionContext(virtual, virtual.selection, { operation: 'normal-selection',
		editIntent: 'cut', imeComposing: false, selectionMode: 'continuous', selectionsCount: 1 });
	if (!context) {
		const plan = planCalloutInput(source, source.selection.main.from, source.selection.main.to, key === 'Enter' ? '\n\n' : '\n');
		return plan ? withCreatedBodies(source, projection, plan) : null;
	}
	const cut = createSelectionCutPlan(context);
	if (!cut) return null;
	validateEditPlan(virtual.doc.toString(), cut, { expectedOperation: 'normal-selection', expectedScope: context.editScope,
		authoritativeProtectedRanges: enumerateListItems(virtual).map((item) => item.prefix.full) });
	const isolated = EditorState.create({ doc: source.doc, selection: source.selection });
	const first = isolated.update(mapCalloutPlan(source, projection, cut));
	const insert = planCalloutKey(first.state, key);
	if (!insert) return null;
	const second = first.state.update(insert);
	return {...transaction(first.changes.compose(second.changes), second.newSelection), effects:second.effects};
}

function withCreatedBodies(source: EditorState, projection: CalloutProjection, plan: TransactionSpec): TransactionSpec {
	const start = projection.state.selection.main.from;
	const line = projection.state.doc.lineAt(start);
	return {...plan, effects: [registerEmptyBody.of((plan.selection as EditorSelection).main.head),
		...(start === line.from ? [registerEmptyBody.of(source.selection.main.from)] : [])]};
}

export function planCalloutKey(state: EditorState, key: CalloutKey): TransactionSpec | null {
	if (state.selection.ranges.length !== 1) return null;
	const projection = projectCallout(state);
	if (!projection) return null;
	if (hasNativeOwnership(syntaxTree(projection.state), projection.state.selection.main.from, projection.state.selection.main.to)) return null;
	if (!state.selection.main.empty) {
		let nested = false;
		syntaxTree(projection.state).iterate({ from: projection.state.selection.main.from, to: projection.state.selection.main.to,
			enter(node) { if (node.name === 'Blockquote') nested = true; } });
		return nested ? null : selectionKey(state, projection, key);
	}
	if (key === 'Enter') {
		const special = emptyParagraph(projection);
		if (special) return special;
	}
	const plan = planListStructural(projection.state, key);
	if (plan) return mapCalloutPlan(state, projection, plan);
	let paragraph = key === 'Enter' || key === 'Shift-Enter'
		? planParagraphEnter(projection.state, key === 'Enter' ? 'enter' : 'shift-enter')
		: key === 'Backspace' || key === 'Delete' ? planGapDeletion(projection.state, key === 'Backspace' ? 'backspace' : 'delete') : null;
	if (!paragraph) {
		if (key === 'Backspace') {
			const line = projection.state.doc.lineAt(projection.state.selection.main.head);
			if (!line.text.trim()) {
				const original = projection.lines[line.number - 1]!;
				if (line.number > 1) {
					const from = state.doc.lineAt(original.from - 1).to;
					return transaction({from,to:original.from + original.prefix.length + line.length},EditorSelection.single(from));
				}
				if (projection.lines.length > 1) {
					const next = projection.lines[1]!;
					return transaction({from:original.from,to:next.from},EditorSelection.single(original.from + next.prefix.length));
				}
			}
		}
		return key === 'Backspace' || key === 'Delete' ? paragraphDelete(state, projection, key) : null;
	}
	paragraph = adaptParagraphBlockGap(projection.state, paragraph, state.facet(codeMarkersActive));
	validateParagraphEditPlan(projection.state.doc.length, paragraph, paragraph.operation);
	const mapped = mapCalloutPlan(state, projection, { changes: [paragraph.change], selection: paragraph.selection,
		ownership: { regionIds: [] }, exceptionId: null });
	return key === 'Enter' || key === 'Shift-Enter' ? withCreatedBodies(state, projection, mapped) : mapped;
}

function paragraphDelete(source: EditorState, projection: CalloutProjection, key: 'Backspace' | 'Delete'): TransactionSpec | null {
	const state = projection.state;
	const caret = state.selection.main.head;
	const paragraph = ordinaryParagraphAtCaret(state, caret, requireParagraphProjectionState(state).authority.paragraphs);
	if (!paragraph) return null;
	if (key === 'Backspace' && caret === 0 || key === 'Delete' && caret === state.doc.length) {
		return transaction([], source.selection);
	}
	const line = state.doc.lineAt(caret);
	const from = key === 'Delete' ? caret : caret === line.from ? caret - 1 : line.from + findClusterBreak(line.text, caret - line.from, false);
	const to = key === 'Backspace' ? caret : caret === line.to ? caret + 1 : line.from + findClusterBreak(line.text, caret - line.from, true);
	if (from < paragraph.from || to > paragraph.to || hasNativeOwnership(syntaxTree(state), from, to)) return null;
	return mapCalloutPlan(source, projection, { changes: [{ from, to, insert: '' }], selection: EditorSelection.single(from),
		ownership: { regionIds: [] }, exceptionId: null });
}
