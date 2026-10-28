import { ChangeSet, EditorSelection, type EditorState } from '@codemirror/state';
import { analyzeSource, type AnalyzedItem, type SourceAnalysis } from './context-analysis.js';
import { buildListTopology } from './context-topology.js';
import { buildSelectionIndentScope } from './context-scopes.js';
import type { EditPlanFragment, EditScope } from './edit-plan.js';
import type { ContextRuntime, ListBlockRef, OrderedSequenceContext, PrefixPolicy, SourceRange, SourceSnapshot } from './model.js';
import type { OperationResult } from './operations.js';
import { markdownColumns } from './prefix.js';
import { composeEditPlan, remapIndentation, replaceListBlockPrefix } from './primitives.js';
import { enumerateListItems } from './syntax.js';
import { indentBoundaryChanges } from './indent-boundaries.js';

type IndentOperation = 'tab' | 'shift-tab';

export interface SelectionIndentResult {
	readonly scope: EditScope;
	readonly result: OperationResult;
}

interface ItemMovement {
	readonly item: AnalyzedItem;
	readonly delta: number | null;
}

interface OrderedMovementGroup {
	readonly movements: ItemMovement[];
	readonly sequence: OrderedSequenceContext;
	readonly parentSequence: OrderedSequenceContext | null;
	readonly indentStart: number;
	readonly crossFamily: boolean;
}

interface NumberedItem {
	readonly block: ListBlockRef;
	readonly value: number;
}

function physicalIndent(source: SourceSnapshot, item: AnalyzedItem): number {
	return markdownColumns(source.slice({ from: item.line.from,
		to: item.block.prefix.outerMarker.to - item.block.prefix.markerText.length - item.block.prefix.separatorText.length }));
}

function replaceSelection(state: EditorState, source: SourceSnapshot): SelectionIndentResult {
	const range = state.selection.main;
	const id = { kind: 'owned-block', index: 0 } as const;
	const scope = buildSelectionIndentScope('tab', [{ from: range.from, to: range.to }], source.length);
	const fragment: EditPlanFragment = { operation: 'tab', regionIds: [id], ownership: { regionIds: [id] },
		changes: [{ from: range.from, to: range.to, insert: '\t' }],
		selection: EditorSelection.single(range.from + 1) };
	return { scope, result: { kind: 'edit', plan: composeEditPlan('tab', scope, [fragment]) } };
}

function selectionGate(
	state: EditorState,
	runtime: ContextRuntime,
): boolean {
	return runtime.selectionMode === 'continuous' && runtime.selectionsCount === 1 &&
		!runtime.imeComposing && !state.selection.main.empty;
}

function selectedItems(state: EditorState, analysis: SourceAnalysis) {
	const range = state.selection.main;
	const lines = analysis.lines.filter(line => line.from < range.to && range.from <= line.to);
	const selected = analysis.items.filter(item => lines.some(line => line.from === item.line.from));
	const roots = selected.filter(item => !selected.some(parent => parent !== item &&
		parent.block.item.from < item.block.item.from && item.block.item.to <= parent.block.item.to));
	const ordinary = lines.some(line => line.text.trim().length > 0 && !roots.some(item =>
		item.line.from <= line.from && line.to <= item.block.item.to));
	return { roots, ordinary };
}

function movementFor(analysis: SourceAnalysis, item: AnalyzedItem, operation: IndentOperation): ItemMovement {
	const topology = buildListTopology(analysis, item);
	const currentIndent = physicalIndent(analysis.source, item);
	if (operation === 'tab') {
		const previous = topology.indentParent;
		const target = previous ? markdownColumns(analysis.source.slice({ from: previous.lineFrom, to: previous.prefix.outerMarker.to })) : null;
		return { item, delta: target === null ? null : target - currentIndent };
	}
	const parent = topology.parent;
	const target = parent ? markdownColumns(analysis.source.slice({ from: parent.lineFrom,
		to: parent.prefix.outerMarker.to - parent.prefix.markerText.length - parent.prefix.separatorText.length })) : null;
	return { item, delta: target === null ? null : target - currentIndent };
}

function movementRegions(analysis: SourceAnalysis, movements: readonly ItemMovement[]) {
	const ranges: SourceRange[] = [];
	const deltas: number[] = [];
	for (const movement of movements) {
		for (const line of analysis.lines) {
			if (line.from < movement.item.line.from || line.from >= movement.item.block.item.to || line.text.trim().length === 0) continue;
			ranges.push({ from: line.from, to: line.to });
			deltas.push(movement.delta!);
		}
	}
	return { ranges, deltas };
}

function orderedMovementGroups(analysis: SourceAnalysis, movements: readonly ItemMovement[]): readonly OrderedMovementGroup[] {
	const groups = new Map<number, OrderedMovementGroup>();
	for (const movement of movements) {
		const topology = buildListTopology(analysis, movement.item);
		const sequence = topology.orderedSequence;
		if (!sequence) continue;
		const key = sequence.items[0]!.lineFrom;
		let group = groups.get(key);
		if (!group) {
			group = { sequence, parentSequence: topology.parentOrderedSequence,
				indentStart: topology.orderedIndentStart, crossFamily: topology.indentParent !== null && topology.previousSibling === null,
				movements: [] };
			groups.set(key, group);
		}
		group.movements.push(movement);
	}
	return [...groups.values()];
}

function adjustNumber(numbers: Map<number, NumberedItem>, block: ListBlockRef, base: number, delta: number): void {
	if (delta === 0) return;
	numbers.set(block.lineFrom, { block, value: (numbers.get(block.lineFrom)?.value ?? base) + delta });
}

function renumberRemaining(numbers: Map<number, NumberedItem>, group: OrderedMovementGroup): void {
	const firstValue = group.sequence.items[0]!.prefix.orderedValue!;
	group.sequence.items.forEach((block, index) => {
		if (group.movements.some(movement => movement.item.line.from === block.lineFrom)) return;
		const removed = group.movements.filter(movement => movement.item.line.from < block.lineFrom).length;
		adjustNumber(numbers, block, firstValue + index, -removed);
	});
}

function renumberParentFollowing(numbers: Map<number, NumberedItem>, group: OrderedMovementGroup): void {
	const sequence = group.parentSequence;
	if (!sequence) return;
	const firstValue = sequence.items[0]!.prefix.orderedValue!;
	sequence.items.forEach((block, index) => {
		if (index > sequence.currentIndex) adjustNumber(numbers, block, firstValue + index, group.movements.length);
	});
}

function movedFirstValue(numbers: ReadonlyMap<number, NumberedItem>, group: OrderedMovementGroup, operation: IndentOperation): number | null {
	if (operation === 'tab') return group.indentStart;
	const sequence = group.parentSequence;
	if (!sequence) return null;
	const parent = sequence.items[sequence.currentIndex]!;
	return (numbers.get(parent.lineFrom)?.value ?? sequence.renderedValue) + 1;
}

function orderedNumbers(analysis: SourceAnalysis, movements: readonly ItemMovement[], operation: IndentOperation): ReadonlyMap<number, NumberedItem> {
	const numbers = new Map<number, NumberedItem>();
	const groups = orderedMovementGroups(analysis, movements);
	for (const group of groups) {
		if (operation !== 'tab' || !group.crossFamily) renumberRemaining(numbers, group);
		if (operation === 'shift-tab') renumberParentFollowing(numbers, group);
	}
	for (const group of groups) {
		const firstValue = movedFirstValue(numbers, group, operation);
		if (firstValue === null) continue;
		group.movements.forEach((movement, index) => numbers.set(movement.item.line.from,
			{ block: movement.item.block, value: firstValue + index }));
	}
	return numbers;
}

function movementPlan(
	analysis: SourceAnalysis,
	movements: readonly ItemMovement[],
	operation: IndentOperation,
	policy: PrefixPolicy,
) {
	const { ranges, deltas } = movementRegions(analysis, movements);
	const numbers = orderedNumbers(analysis, movements, operation);
	const lines = ranges.map((range, index) => ({ range, delta: deltas[index]! }));
	for (const { block } of numbers.values()) {
		if (!lines.some(line => line.range.from === block.lineFrom)) {
			lines.push({ range: { from: block.lineFrom, to: block.prefix.full.to }, delta: 0 });
		}
	}
	lines.sort((left, right) => left.range.from - right.range.from);
	const joins = operation === 'tab' ? movements.flatMap((movement, index) => {
		const topology = buildListTopology(analysis, movement.item);
		if (!topology.indentParent || movements.some(other => other.item.block.item.from === topology.indentParent!.item.from)) return [];
		let last = movement.item;
		for (const following of movements.slice(index + 1)) {
			if (following.item.parentIndex !== movement.item.parentIndex) break;
			last = following.item;
		}
		return indentBoundaryChanges(analysis.source, movement.item.block, topology, last.block);
	}) : [];
	const scope = buildSelectionIndentScope(operation, [...lines.map(line => line.range), ...joins], analysis.source.length);
	const fragments = lines.map((line, index) => {
		const id = scope.regionIds[index]!;
		const numbered = numbers.get(line.range.from);
		if (!numbered) return remapIndentation(analysis.source, scope, [id], line.delta);
		const block = numbered.block;
		const indent = markdownColumns(analysis.source.slice({ from: block.lineFrom,
			to: block.prefix.outerMarker.to - block.prefix.markerText.length - block.prefix.separatorText.length })) + line.delta;
		const token = block.prefix.taskToken ? analysis.source.slice(block.prefix.taskToken) : '';
		const prefix = ' '.repeat(indent) + policy.renderSameLevel({ ...block.prefix, kind: 'ordered' }, { orderedValue: numbered.value }) + token;
		return replaceListBlockPrefix(analysis.source, scope, id, block, prefix);
	});
	const joinFragments: EditPlanFragment[] = joins.map((change, index) => {
		const id = scope.regionIds[lines.length + index]!;
		return { operation, regionIds: [id], ownership: { regionIds: [id] }, changes: [change], selection: null };
	});
	const orderedFragments = [...fragments, ...joinFragments].sort((left, right) =>
		scope.region(left.regionIds[0]!)!.range.from - scope.region(right.regionIds[0]!)!.range.from);
	const plan = composeEditPlan(operation, scope, orderedFragments);
	return { scope, plan };
}

function selectionMovements(analysis: SourceAnalysis, roots: readonly AnalyzedItem[], operation: IndentOperation) {
	const movements: ItemMovement[] = [];
	for (const item of roots) {
		const movement = movementFor(analysis, item, operation);
		const parent = operation === 'tab' ? buildListTopology(analysis, item).indentParent : null;
		const selectedParent = parent && movements.find(candidate => candidate.item.line.from === parent.lineFrom);
		movements.push(selectedParent ? { item, delta: selectedParent.delta } : movement);
	}
	return movements;
}

/** Plan from one source snapshot; a selected ancestor owns each descendant line once. */
export function planSelectionIndent(
	state: EditorState,
	operation: IndentOperation,
	runtime: ContextRuntime,
	policy: PrefixPolicy,
): SelectionIndentResult | null {
	if (!selectionGate(state, runtime)) return null;
	const analysis = analyzeSource(state, enumerateListItems(state));
	const { roots, ordinary } = selectedItems(state, analysis);
	if (roots.length === 0) return null;
	const movements = selectionMovements(analysis, roots, operation);
	if (ordinary || movements.some(movement => movement.delta === null || movement.delta === 0)) {
		return operation === 'tab' ? replaceSelection(state, analysis.source) : null;
	}
	const { scope, plan } = movementPlan(analysis, movements, operation, policy);
	const mapped = state.selection.map(ChangeSet.of(plan.changes, analysis.source.length));
	return { scope, result: { kind: 'edit', plan: { ...plan, selection: mapped } } };
}
