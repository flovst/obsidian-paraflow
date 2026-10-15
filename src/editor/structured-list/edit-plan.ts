import { isolateHistory } from '@codemirror/commands';
import {
	Annotation,
	ChangeSet,
	StateField,
	Transaction,
	type ChangeSpec,
	type EditorSelection,
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SourceRange } from './model.js';
import type {
	HandledOperationId,
	OperationResult,
	OperationResultServices,
} from './operations.js';
import { selectionModeAnnotation } from '../runtime/input-state.js';

export type EditRegionKind =
	| 'current-prefix'
	| 'current-content'
	| 'current-item'
	| 'preceding-container'
	| 'previous-sibling'
	| 'next-sibling'
	| 'owned-block'
	| 'whitespace-boundary'
	| 'structural-boundary'
	| 'following-block'
	| 'ordered-sequence-item'
	| 'parent-ordered-sequence-item'
	| 'terminal-newlines'
	| 'terminal-insertion'
	| 'selection-start-content'
	| 'selection-end-content'
	| 'selection-intervening-item';

export interface EditRegionId {
	readonly kind: EditRegionKind;
	readonly index: number | null;
}

export interface ContextEditRegion {
	readonly id: EditRegionId;
	readonly range: SourceRange;
	readonly protection: 'ordinary' | 'protected-prefix';
}

export interface EditScope {
	readonly operation: HandledOperationId;
	readonly mode: 'editable' | 'selection-only';
	readonly regionIds: readonly EditRegionId[];
	region(id: EditRegionId): ContextEditRegion | null;
}

export interface EditValidationInput {
	readonly expectedOperation: HandledOperationId;
	readonly expectedScope: EditScope;
	readonly authoritativeProtectedRanges: readonly SourceRange[];
}

export interface EditOwnership {
	readonly regionIds: readonly EditRegionId[];
}

export interface EditPlan {
	readonly changes: readonly ChangeSpec[];
	readonly selection: EditorSelection | null;
	readonly ownership: EditOwnership;
	readonly exceptionId: `SLX-${string}` | null;
	readonly ownsOrderedNumbering?: true;
}

export interface EditPlanFragment {
	readonly operation: HandledOperationId;
	readonly regionIds: readonly EditRegionId[];
	readonly changes: readonly ChangeSpec[];
	readonly selection: EditorSelection | null;
	readonly ownership: EditOwnership;
}

const enterRegionKinds = [
	'current-prefix',
	'current-content',
	'current-item',
	'owned-block',
	'whitespace-boundary',
	'structural-boundary',
	'following-block',
	'ordered-sequence-item',
] as const satisfies readonly EditRegionKind[];
const shiftTabRegionKinds = [
	...enterRegionKinds,
	'parent-ordered-sequence-item',
] as const satisfies readonly EditRegionKind[];
const boundaryBackspaceRegionKinds = [
	'current-prefix',
	'current-content',
	'current-item',
	'preceding-container',
	'previous-sibling',
	'next-sibling',
	'owned-block',
	'whitespace-boundary',
	'structural-boundary',
	'following-block',
	'ordered-sequence-item',
	'terminal-newlines',
] as const satisfies readonly EditRegionKind[];

export const OPERATION_REGION_KINDS = {
	'backspace-delete-inside-content': [
		'current-content',
		'structural-boundary',
		'following-block',
		'ordered-sequence-item',
		'terminal-newlines',
	],
	'backspace-empty-nested': boundaryBackspaceRegionKinds,
	'backspace-empty-top-level': boundaryBackspaceRegionKinds,
	'backspace-nested-content-start': boundaryBackspaceRegionKinds,
	'backspace-top-level-content-start': boundaryBackspaceRegionKinds,
	'click-prefix-gutter': [],
	end: [],
	'enter-empty-nested': enterRegionKinds,
	'enter-empty-top-level': enterRegionKinds,
	'enter-non-empty': enterRegionKinds,
	'enter-task-non-empty': enterRegionKinds,
	home: [],
	'left-content-start': [],
	'normal-selection': [
		'selection-start-content',
		'selection-end-content',
		'selection-intervening-item',
		'whitespace-boundary',
		'structural-boundary',
	],
	right: [],
	'shift-enter': enterRegionKinds,
	'shift-tab': shiftTabRegionKinds,
	tab: [
		'current-content',
		'current-item',
		'owned-block',
		'whitespace-boundary',
		'ordered-sequence-item',
	],
	'up-down': ['terminal-insertion'],
} as const satisfies Readonly<Record<HandledOperationId, readonly EditRegionKind[]>>;

export const structuralEditAnnotation = Annotation.define<HandledOperationId>();
export const structuralExceptionAnnotation = Annotation.define<EditPlan['exceptionId']>();

const enterOperations = new Set<HandledOperationId>([
	'enter-empty-nested',
	'enter-empty-top-level',
	'enter-non-empty',
	'enter-task-non-empty',
	'shift-enter',
]);

export const exceptionSinkStateField = StateField.define<EditPlan['exceptionId']>({
	create: () => null,
	update(value, transaction) {
		const exceptionId = transaction.annotation(structuralExceptionAnnotation);
		return exceptionId === undefined ? value : exceptionId;
	},
});

const idKey = (id: EditRegionId): string => `${id.kind}:${id.index === null ? 'null' : id.index}`;

const sameId = (left: EditRegionId, right: EditRegionId): boolean =>
	left.kind === right.kind && left.index === right.index;

function validateRange(range: SourceRange, sourceLength: number, label: string): void {
	if (
		!Number.isInteger(range.from) ||
		!Number.isInteger(range.to) ||
		range.from < 0 ||
		range.to < range.from ||
		range.to > sourceLength
	) {
		throw new RangeError(`${label} is outside the source snapshot`);
	}
}

function validateRegionDefinitions(
	regions: readonly ContextEditRegion[],
	sourceLength: number,
): void {
	const ids = new Set<string>();
	for (const region of regions) {
		validateRange(region.range, sourceLength, `Edit region ${idKey(region.id)}`);
		if (ids.has(idKey(region.id))) {
			throw new Error(`Edit scope contains duplicate region ID ${idKey(region.id)}`);
		}
		ids.add(idKey(region.id));
	}
	const ordered = [...regions].sort((left, right) => left.range.from - right.range.from);
	for (let index = 1; index < ordered.length; index += 1) {
		const previous = ordered[index - 1]!;
		const current = ordered[index]!;
		if (current.range.from < previous.range.to) {
			throw new Error('Edit scope contains overlapping region definitions');
		}
	}
}

export function createEditScope(
	operation: HandledOperationId,
	mode: EditScope['mode'],
	definitions: readonly ContextEditRegion[],
	sourceLength: number,
): EditScope {
	validateRegionDefinitions(definitions, sourceLength);
	const allowed = new Set<EditRegionKind>(OPERATION_REGION_KINDS[operation]);
	const regions = mode === 'selection-only'
		? []
		: definitions.filter((region) => allowed.has(region.id.kind));
	return {
		mode,
		operation,
		region: (id) => regions.find((region) => sameId(region.id, id)) ?? null,
		regionIds: regions.map((region) => region.id),
	};
}

type ConcreteChange = SourceRange;

function isChangeSpecArray(spec: ChangeSpec): spec is readonly ChangeSpec[] {
	return Array.isArray(spec);
}

function inspectChangeSpec(spec: ChangeSpec, sourceLength: number): readonly ConcreteChange[] {
	if (isChangeSpecArray(spec)) {
		return spec.flatMap((nested) => inspectChangeSpec(nested, sourceLength));
	}
	const changes: ConcreteChange[] = [];
	try {
		ChangeSet.of(spec, sourceLength).iterChanges((from, to) => changes.push({ from, to }));
	} catch {
		throw new RangeError('Edit plan change is outside the document');
	}
	return changes;
}

function inspectChanges(changes: readonly ChangeSpec[], sourceLength: number): readonly ConcreteChange[] {
	const concrete = changes.flatMap((change) => inspectChangeSpec(change, sourceLength));
	if (concrete.length === 0) throw new Error('Edit plan must contain a source change');
	for (let index = 1; index < concrete.length; index += 1) {
		const previous = concrete[index - 1]!;
		const current = concrete[index]!;
		if (current.from < previous.from) throw new Error('Edit plan changes must be ordered');
		if (current.from < previous.to || current.from === previous.from) {
			throw new Error('Edit plan changes must not overlap');
		}
	}
	return concrete;
}

function resolveOwnedRegions(plan: EditPlan, input: EditValidationInput): readonly ContextEditRegion[] {
	if (input.expectedScope.operation !== input.expectedOperation) {
		throw new Error('Edit scope does not match the expected operation');
	}
	if (input.expectedScope.mode !== 'editable') {
		throw new Error('A selection-only scope cannot authorize an edit plan');
	}
	const keys = plan.ownership.regionIds.map(idKey);
	if (new Set(keys).size !== keys.length) {
		throw new Error('Edit plan ownership contains a duplicate region ID');
	}
	return plan.ownership.regionIds.map((id) => {
		const region = input.expectedScope.region(id);
		if (!region) throw new Error(`Region ${idKey(id)} is not in the expected edit scope`);
		return region;
	});
}

function containsChange(region: SourceRange, change: ConcreteChange): boolean {
	if (change.from === change.to) {
		return region.from <= change.from && change.from <= region.to;
	}
	return region.from <= change.from && change.to <= region.to;
}

function touchesRange(change: ConcreteChange, range: SourceRange): boolean {
	if (change.from === change.to) return range.from < change.from && change.from < range.to;
	return change.from < range.to && range.from < change.to;
}

function authorizeChange(
	change: ConcreteChange,
	regions: readonly ContextEditRegion[],
	protectedRanges: readonly SourceRange[],
): void {
	const region = regions.find((candidate) => containsChange(candidate.range, change));
	if (!region) throw new Error('Edit plan change is outside every owned named edit region');
	const touchesProtectedPrefix = protectedRanges.some((range) => touchesRange(change, range));
	if (touchesProtectedPrefix && region.protection !== 'protected-prefix') {
		throw new Error('An ordinary edit region cannot authorize a protected prefix change');
	}
}

export function validateEditPlan(
	source: string,
	plan: EditPlan,
	input: EditValidationInput,
): void {
	for (const range of input.authoritativeProtectedRanges) {
		validateRange(range, source.length, 'Protected range');
	}
	const regions = resolveOwnedRegions(plan, input);
	const changes = inspectChanges(plan.changes, source.length);
	for (const change of changes) {
		authorizeChange(change, regions, input.authoritativeProtectedRanges);
	}
}

function dispatchValidatedEditPlan(
	view: EditorView,
	expectedOperation: HandledOperationId,
	plan: EditPlan,
): void {
	// Obsidian skips automatic numbering when this transaction already owns it.
	const inputEvent = plan.ownsOrderedNumbering ? 'input.renumber' : 'input';
	const historyAnnotations = enterOperations.has(expectedOperation)
		? [Transaction.userEvent.of(inputEvent), isolateHistory.of(expectedOperation === 'shift-enter' ? 'full' : 'before')]
		: expectedOperation === 'tab' || expectedOperation === 'shift-tab'
			? [Transaction.userEvent.of(inputEvent), isolateHistory.of('full')]
		: [];
	view.dispatch({
		annotations: [
			selectionModeAnnotation.of('normal'),
			structuralEditAnnotation.of(expectedOperation),
			structuralExceptionAnnotation.of(plan.exceptionId),
			...historyAnnotations,
		],
		changes: plan.changes,
		scrollIntoView: true,
		selection: plan.selection ?? undefined,
	});
}

export function dispatchEditPlan(
	view: EditorView,
	expectedOperation: HandledOperationId,
	expectedScope: EditScope,
	plan: EditPlan,
	validation: Omit<EditValidationInput, 'expectedOperation' | 'expectedScope'>,
): void {
	validateEditPlan(view.state.doc.toString(), plan, {
		...validation,
		expectedOperation,
		expectedScope,
	});
	dispatchValidatedEditPlan(view, expectedOperation, plan);
}

export function dispatchTaskCheckboxToggle(view: EditorView, tokenFrom: number): void {
	const token = view.state.doc.sliceString(tokenFrom, tokenFrom + 3);
	if (!/^\[[ xX]\]$/u.test(token)) return;
	view.dispatch({
		annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')],
		changes: {
			from: tokenFrom + 1,
			to: tokenFrom + 2,
			insert: token[1]?.toLowerCase() === 'x' ? ' ' : 'x',
		},
	});
}

function applyClipboardResult(
	view: EditorView,
	expectedOperation: HandledOperationId,
	expectedScope: EditScope,
	result: Extract<OperationResult, { readonly kind: 'clipboard' }>,
	services: OperationResultServices,
): void {
	const state = view.state;
	services.clipboard.writeText(result.text);
	if (result.edit) {
		if (view.state !== state) {
			throw new Error('Editor state changed while writing Cut clipboard data');
		}
		validateEditPlan(view.state.doc.toString(), result.edit, {
			...services.validation,
			expectedOperation,
			expectedScope,
		});
		dispatchValidatedEditPlan(view, expectedOperation, result.edit);
	}
}

function applyHandledResult(
	view: EditorView,
	expectedOperation: HandledOperationId,
	expectedScope: EditScope,
	result: Exclude<OperationResult, { readonly kind: 'pass-through' }>,
	services: OperationResultServices,
): void {
	if (result.kind === 'selection') {
		view.dispatch({
			annotations: selectionModeAnnotation.of('normal'),
			selection: result.selection,
			scrollIntoView: true,
		});
		return;
	}
	if (result.kind === 'edit') {
		dispatchEditPlan(view, expectedOperation, expectedScope, result.plan, services.validation);
		return;
	}
	applyClipboardResult(view, expectedOperation, expectedScope, result, services);
}

export function applyOperationResult(
	view: EditorView,
	expectedOperation: HandledOperationId,
	expectedScope: EditScope,
	result: OperationResult,
	services: OperationResultServices,
): boolean {
	if (result.kind === 'pass-through') return false;
	applyHandledResult(view, expectedOperation, expectedScope, result, services);
	return true;
}
