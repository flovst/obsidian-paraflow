import { creationHistory } from '../runtime/creation-history.js';
import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { ChangeSet, EditorSelection, EditorState, findClusterBreak, Transaction, type TransactionSpec } from '@codemirror/state';
import { buildListContext, buildSelectionContext } from '../structured-list/context.js';
import { planSelectionIndent } from '../structured-list/selection-indent.js';
import { createEditScope, validateEditPlan, type EditPlan } from '../structured-list/edit-plan.js';
import type { ContextRuntime } from '../structured-list/model.js';
import { executeRegisteredOperation, type StructuralOperationId } from '../structured-list/operations.js';
import { prefixPolicy } from '../structured-list/prefix.js';
import { composeEditPlan, createSelectionCutPlan, remapIndentation } from '../structured-list/primitives.js';
import { enumerateListItems } from '../structured-list/syntax.js';
import { planGapDeletion, planOwnedWhitespaceDeletion, planParagraphEnter } from '../paragraph/operations.js';
import { adaptParagraphBlockGap, validateParagraphEditPlan } from '../paragraph/edit-plan.js';
import { codeMarkersActive } from '../code-blocks/editable-boundaries.js';
import { requireParagraphProjectionState } from '../paragraph/projection.js';
import { ordinaryParagraphAtCaret } from '../paragraph/syntax.js';
import { projectCallout, quotePrefix, type CalloutProjection } from './projection.js';
import { hasNativeOwnership } from './syntax.js';
import {quoteContainers} from './presentation-model.js';
import {createdBodyOwnership,emptyBodies,registerEmptyBody} from '../runtime/empty-body-state.js';

export type CalloutKey = 'Enter' | 'Shift-Enter' | 'Tab' | 'Shift-Tab' | 'Backspace' | 'Delete';

function emptyBody(state:EditorState,from:number,to:number):boolean {
	const body=state.sliceDoc(from,to);
	return body==='' || body==='\u200b'&&createdBodyOwnership(state).some(owner=>owner.maintenanceFrom===from);
}

/** The icon/prefix boundary is outside body projection but remains a visible editing endpoint. */
export function planContainerStartEnter(state: EditorState): TransactionSpec | null {
	if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
	const head = state.selection.main.head;
	const card = quoteContainers(state).find(candidate => {
		const line = state.doc.lineAt(candidate.from), prefix = quotePrefix(line.text, candidate.depth)!;
		return head === line.from + prefix.lastIndexOf('>');
	});
	if (!card) return null;
	const line = state.doc.lineAt(card.from), prefix = quotePrefix(line.text, card.depth)!;
	const outer = prefix.slice(0, prefix.lastIndexOf('>'));
	const from = card.kind === 'callout' ? head : line.from + prefix.length;
	const continuation = card.kind === 'callout' ? outer : prefix;
	const insert = `\n${continuation}\n${continuation}`;
	return { ...transaction({from, insert}, EditorSelection.single(from + insert.length)),
		effects: registerEmptyBody.of(from) };
}

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
		if (prefix === null || !emptyBody(state,line.from+prefix.length,line.to)) return null;
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
	const selected = (plan.selection ?? virtual.selection).main;
	const mappedSelection = selected.empty
		? EditorSelection.cursor(map(selected.head), selected.assoc, selected.bidiLevel ?? undefined, selected.goalColumn)
		: EditorSelection.range(map(selected.anchor), map(selected.head), selected.goalColumn, selected.bidiLevel ?? undefined);
	const result = transaction(changes, EditorSelection.create([mappedSelection]));
	// Deleting the last body character leaves an editable paragraph, not a source gap.
	const originalLine = projection.state.doc.lineAt(projection.state.selection.main.head);
	const createdBody = emptyBodies(projection.state).some(anchor => originalLine.from <= anchor && anchor <= originalLine.to);
	return selected.empty && (originalLine.text.trim() !== '' || createdBody) &&
		/^[ \t]*$/u.test(virtual.doc.lineAt(selected.head).text)
		? { ...result, effects: registerEmptyBody.of(mappedSelection.head) } : result;
}

function emptyParagraph(source:EditorState,projection: CalloutProjection): TransactionSpec | null {
	const virtual = projection.state;
	const line = virtual.doc.lineAt(virtual.selection.main.head);
	const bodyFrom=projection.toSource(line.from),bodyTo=projection.toSource(line.to);
	if (!emptyBody(source,bodyFrom,bodyTo)) return null;
	if(line.length){
		// Remove only this session's save-inserted boundary before reusing gap ownership.
		const first=source.update({changes:{from:bodyFrom,to:bodyTo},selection:EditorSelection.cursor(bodyFrom),effects:registerEmptyBody.of(bodyFrom)});
		const plan=planCalloutKey(first.state,'Enter')!;
		const second=first.state.update(plan);
		return {...transaction(first.changes.compose(second.changes),second.newSelection),effects:second.effects};
	}
	const original = projection.lines[line.number - 1]!;
	const outer = original.prefix.slice(0, original.prefix.lastIndexOf('>'));
	const anchor = original.from + outer.length;
	const run = requireParagraphProjectionState(virtual).authority.runs.find(run =>
		run.from < line.from && line.to <= run.to);
	if (run) {
		const before = run.gaps.find(gap => gap.to === line.to);
		const after = run.gaps.find(gap => gap.from === line.to);
		// A lone terminal newline is a separator unless a session body explicitly owns it.
		if (before && after && (run.kind !== 'trailing' || after.to - after.from >= 2 || emptyBodies(virtual).includes(after.to))) {
			// Both separators belong to this body; the next body's prefix remains quoted.
			const from = projection.toSource(before.from);
			const to = projection.lines[virtual.doc.lineAt(after.to).number - 1]!.from;
			const insert = `\n${outer}\n${outer}\n${outer}\n`;
			const caret = from + 2 + outer.length * 2;
			return { ...transaction({ from, to, insert }, EditorSelection.single(caret)),
				effects: [registerEmptyBody.of(caret), creationHistory.of({ owner: 'container', from,
					draftOffset: projection.toSource(virtual.selection.main.head) - from, bodyOffset: caret - from, created: true })] };
		}
	}
	const trailing = run?.kind === 'trailing' ? run : undefined;
	// Tail separators belong to the exiting body; later complete bodies keep their prefixes.
	const end = trailing && !trailing.editableAnchors.some(body => line.to < body && (body - line.to >= 2 || emptyBodies(virtual).includes(body)))
		? projection.lines.length : line.number;
	const preceding = trailing?.gaps.find(gap => gap.to === line.to);
	if (end === projection.lines.length && trailing) {
		// Transfer this body's owned separators to an ordinary paragraph at the outer level.
		const from = projection.toSource(preceding?.from ?? trailing.from);
		const separator = `\n${outer}\n${outer}`;
		const remaining = trailing.to - line.to;
		const insert = separator + (remaining >= 2 ? `\n${outer}`.repeat(remaining) : '');
		const caret = from + separator.length;
		return { ...transaction({ from, to: projection.end, insert },
			EditorSelection.single(caret)), effects: registerEmptyBody.of(caret) };
	}
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
		const line = virtual.doc.lineAt(virtual.selection.main.head);
		if (context.current.lineFrom !== line.from && prefixPolicy.parse(line.text, line.from)) return null;
		if (context.current.lineFrom !== virtual.doc.lineAt(virtual.selection.main.head).from &&
			!((key === 'Enter' || key === 'Shift-Enter' || key === 'Tab' || key === 'Shift-Tab' || key === 'Delete') && context.caretContent.kind !== 'marker-line')) return continuationPlan(virtual, key, context);
		let hasNestedQuote = false;
		syntaxTree(virtual).iterate({ from: context.current.item.from, to: context.current.item.to,
			enter(node) { if (node.name === 'Blockquote') hasNestedQuote = true; } });
		if (hasNestedQuote && (key === 'Tab' || key === 'Shift-Tab')) return null;
		const subtree = key === 'Tab' && context.caretContent.kind === 'marker-line' ? subtreeIndent(context) : null;
		const result = subtree ? { kind: 'edit' as const, plan: subtree } : executeRegisteredOperation({ context,
			intent: { family: 'structural', operation,
				direction: key === 'Backspace' ? 'backward' : key === 'Delete' ? 'forward' : null },
			services: { prefixPolicy } });
		if (result.kind !== 'edit') {
			if (key === 'Delete' && context.caretContent.kind !== 'marker-line') return continuationPlan(virtual, key, context);
			continue;
		}
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
	return null;
}

function continuationDelete(state: EditorState, key: 'Backspace' | 'Delete',
	context: NonNullable<ReturnType<typeof buildListContext>>): EditPlan | null {
	const caret = state.selection.main.head;
	const line = state.doc.lineAt(caret);
	const start = context.caretContent.range.from;
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

export function planCalloutKey(state: EditorState, key: CalloutKey, includeHeadings = true): TransactionSpec | null {
	if (state.selection.ranges.length !== 1) return null;
	const projection = projectCallout(state);
	if (!projection) return null;
	if (key === 'Backspace' || key === 'Delete') {
		const whitespace = planOwnedWhitespaceDeletion(state, key === 'Backspace' ? 'backspace' : 'delete');
		if (whitespace) return transaction(whitespace.change, whitespace.selection);
	}
	if (hasNativeOwnership(syntaxTree(projection.state), projection.state.selection.main.from, projection.state.selection.main.to)) return null;
	if (!state.selection.main.empty) {
		let nested = false;
		syntaxTree(projection.state).iterate({ from: projection.state.selection.main.from, to: projection.state.selection.main.to,
			enter(node) { if (node.name === 'Blockquote') nested = true; } });
		return nested ? null : selectionKey(state, projection, key);
	}
	const plan = planListStructural(projection.state, key);
	if (plan) {
		const mapped = mapCalloutPlan(state, projection, plan);
		return key === 'Enter' || key === 'Shift-Enter' ? withCreatedBodies(state, projection, mapped) : mapped;
	}
	if (key === 'Enter') {
		const special = emptyParagraph(state,projection);
		if (special) return special;
	}
	let paragraph = key === 'Enter' || key === 'Shift-Enter'
		? planParagraphEnter(projection.state, key === 'Enter' ? 'enter' : 'shift-enter', includeHeadings)
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
