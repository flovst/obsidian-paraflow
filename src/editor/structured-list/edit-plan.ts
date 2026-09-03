import {
	Annotation,
	ChangeSet,
	StateField,
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

const editScopeBrand: unique symbol = Symbol('EditScope');
const stateSnapshotBrand: unique symbol = Symbol('StateSnapshot');
const editCapabilityBrand: unique symbol = Symbol('EditCapability');

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

export interface StateSnapshotId {
	readonly [stateSnapshotBrand]: true;
}

export function createStateSnapshotId(): StateSnapshotId {
	return Object.freeze({ [stateSnapshotBrand]: true as const });
}

export interface EditScopeId {
	readonly [editScopeBrand]: true;
}

export interface EditScope {
	readonly id: EditScopeId;
	readonly stateSnapshotId: StateSnapshotId;
	readonly operation: HandledOperationId;
	readonly mode: 'editable' | 'selection-only';
	readonly regionIds: readonly EditRegionId[];
	region(id: EditRegionId): ContextEditRegion | null;
}

export interface EditScopeFactory {
	create(
		operation: HandledOperationId,
		mode: EditScope['mode'],
		regions: readonly ContextEditRegion[],
	): EditScope;
}

export interface EditCapability {
	readonly [editCapabilityBrand]: true;
	readonly operation: HandledOperationId;
	readonly scopeId: EditScopeId;
	readonly stateSnapshotId: StateSnapshotId;
	readonly regionIds: readonly EditRegionId[];
}

export interface OperationCapabilityProvider {
	request(scope: EditScope, regionIds: readonly EditRegionId[]): EditCapability;
}

export interface ResolvedEditCapability {
	readonly operation: HandledOperationId;
	readonly scopeId: EditScopeId;
	readonly stateSnapshotId: StateSnapshotId;
	readonly regions: readonly ContextEditRegion[];
}

export interface OperationCapabilityVerifier {
	verifyAndResolve(
		capability: EditCapability,
		expectedOperation: HandledOperationId,
		expectedScope: EditScope,
		stateSnapshotId: StateSnapshotId,
		authoritativeProtectedRanges: readonly SourceRange[],
	): ResolvedEditCapability | null;
}

export interface EditValidationInput {
	readonly expectedOperation: HandledOperationId;
	readonly expectedScope: EditScope;
	readonly stateSnapshotId: StateSnapshotId;
	readonly authoritativeProtectedRanges: readonly SourceRange[];
	readonly verifier: OperationCapabilityVerifier;
}

export interface EditOwnership {
	readonly capability: EditCapability;
}

export interface EditPlan {
	readonly changes: readonly ChangeSpec[];
	readonly selection: EditorSelection | null;
	readonly ownership: EditOwnership;
	readonly exceptionId: `SLX-${string}` | null;
}

export interface EditPlanFragment {
	readonly operation: HandledOperationId;
	readonly scopeId: EditScopeId;
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

export interface OperationCapabilityRuntime {
	readonly scopeFactory: EditScopeFactory;
	readonly capabilities: OperationCapabilityProvider;
	readonly verifier: OperationCapabilityVerifier;
}

export const structuralEditAnnotation = Annotation.define<HandledOperationId>();
export const structuralExceptionAnnotation = Annotation.define<EditPlan['exceptionId']>();

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

const sameRanges = (left: readonly SourceRange[], right: readonly SourceRange[]): boolean =>
	left.length === right.length &&
	left.every((range, index) => {
		const candidate = right[index];
		return candidate !== undefined && range.from === candidate.from && range.to === candidate.to;
	});

const cloneId = (id: EditRegionId): EditRegionId => Object.freeze({ ...id });
const cloneRange = (range: SourceRange): SourceRange => Object.freeze({ ...range });
const cloneRegion = (region: ContextEditRegion): ContextEditRegion =>
	Object.freeze({ id: cloneId(region.id), protection: region.protection, range: cloneRange(region.range) });

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
		const previous = ordered[index - 1];
		const current = ordered[index];
		if (previous && current && current.range.from < previous.range.to) {
			throw new Error('Edit scope contains overlapping region definitions');
		}
	}
}

function validateProtectedRanges(
	ranges: readonly SourceRange[],
	sourceLength: number,
): readonly SourceRange[] {
	for (const range of ranges) validateRange(range, sourceLength, 'Protected range');
	return Object.freeze(ranges.map(cloneRange));
}

const scopeContainsId = (scope: EditScope, id: EditRegionId): boolean =>
	scope.regionIds.some((candidate) => sameId(candidate, id));

interface CapabilityRuntimeState {
	readonly stateSnapshotId: StateSnapshotId;
	readonly sourceLength: number;
	readonly protectedSnapshot: readonly SourceRange[];
	readonly mintedScopes: WeakSet<object>;
	readonly mintedCapabilities: WeakSet<object>;
	readonly capabilityRegions: WeakMap<object, readonly ContextEditRegion[]>;
}

function createScopeFactory(runtime: CapabilityRuntimeState): EditScopeFactory {
	return {
		create(operation, mode, definitions) {
			validateRegionDefinitions(definitions, runtime.sourceLength);
			const allowed = new Set<EditRegionKind>(OPERATION_REGION_KINDS[operation]);
			const regions = mode === 'selection-only'
				? []
				: definitions.filter((region) => allowed.has(region.id.kind)).map(cloneRegion);
			const scopeId = Object.freeze({ [editScopeBrand]: true as const });
			const regionIds = Object.freeze(regions.map((region) => region.id));
			const scope = Object.freeze({
				id: scopeId,
				mode,
				operation,
				region: (id: EditRegionId) =>
					regions.find((region) => sameId(region.id, id)) ?? null,
				regionIds,
				stateSnapshotId: runtime.stateSnapshotId,
			}) satisfies EditScope;
			runtime.mintedScopes.add(scope);
			return scope;
		},
	};
}

function assertRequestableScope(scope: EditScope, runtime: CapabilityRuntimeState): void {
	if (!runtime.mintedScopes.has(scope) || scope.stateSnapshotId !== runtime.stateSnapshotId) {
		throw new Error('Edit scope was not minted by this capability runtime');
	}
	if (scope.mode === 'selection-only') {
		throw new Error('Cannot request an edit capability from a selection-only scope');
	}
}

function assertRequestableIds(scope: EditScope, requestedIds: readonly EditRegionId[]): void {
	const keys = requestedIds.map(idKey);
	if (new Set(keys).size !== keys.length) {
		throw new Error('Edit capability request contains a duplicate region ID');
	}
	const allowed = new Set<EditRegionKind>(OPERATION_REGION_KINDS[scope.operation]);
	for (const id of requestedIds) {
		if (!allowed.has(id.kind) || !scopeContainsId(scope, id)) {
			throw new Error(`Region ${idKey(id)} is not in the edit scope`);
		}
	}
}

function createCapabilityProvider(runtime: CapabilityRuntimeState): OperationCapabilityProvider {
	return {
		request(scope, requestedIds) {
			assertRequestableScope(scope, runtime);
			assertRequestableIds(scope, requestedIds);
			const regionIds = Object.freeze(requestedIds.map(cloneId));
			const regions = Object.freeze(
				regionIds
					.map((id) => scope.region(id))
					.filter((region): region is ContextEditRegion => region !== null),
			);
			const capability = Object.freeze({
				[editCapabilityBrand]: true as const,
				operation: scope.operation,
				regionIds,
				scopeId: scope.id,
				stateSnapshotId: runtime.stateSnapshotId,
			}) satisfies EditCapability;
			runtime.mintedCapabilities.add(capability);
			runtime.capabilityRegions.set(capability, regions);
			return capability;
		},
	};
}

function capabilityMatchesScope(
	capability: EditCapability,
	operation: HandledOperationId,
	scope: EditScope,
): boolean {
	return operation === scope.operation &&
		capability.operation === operation &&
		capability.scopeId === scope.id;
}

function capabilityMatchesRuntime(
	capability: EditCapability,
	scope: EditScope,
	snapshotId: StateSnapshotId,
	protectedRanges: readonly SourceRange[],
	runtime: CapabilityRuntimeState,
): boolean {
	return runtime.mintedCapabilities.has(capability) &&
		runtime.mintedScopes.has(scope) &&
		snapshotId === runtime.stateSnapshotId &&
		capability.stateSnapshotId === runtime.stateSnapshotId &&
		sameRanges(runtime.protectedSnapshot, protectedRanges);
}

function createCapabilityVerifier(runtime: CapabilityRuntimeState): OperationCapabilityVerifier {
	return {
		verifyAndResolve(capability, operation, scope, snapshotId, protectedRanges) {
			if (!capabilityMatchesScope(capability, operation, scope)) return null;
			if (!capabilityMatchesRuntime(capability, scope, snapshotId, protectedRanges, runtime)) {
				return null;
			}
			const regions = runtime.capabilityRegions.get(capability);
			if (!regions) return null;
			return Object.freeze({
				operation,
				regions,
				scopeId: scope.id,
				stateSnapshotId: runtime.stateSnapshotId,
			});
		},
	};
}

export function createOperationCapabilityRuntime(
	stateSnapshotId: StateSnapshotId,
	sourceLength: number,
	authoritativeProtectedRanges: readonly SourceRange[],
): OperationCapabilityRuntime {
	if (!Number.isInteger(sourceLength) || sourceLength < 0) {
		throw new RangeError('Source length must be a non-negative integer');
	}
	const runtime: CapabilityRuntimeState = {
		capabilityRegions: new WeakMap<object, readonly ContextEditRegion[]>(),
		mintedCapabilities: new WeakSet<object>(),
		mintedScopes: new WeakSet<object>(),
		protectedSnapshot: validateProtectedRanges(authoritativeProtectedRanges, sourceLength),
		sourceLength,
		stateSnapshotId,
	};
	const scopeFactory = createScopeFactory(runtime);
	const capabilities = createCapabilityProvider(runtime);
	const verifier = createCapabilityVerifier(runtime);
	return Object.freeze({ capabilities, scopeFactory, verifier });
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
		const previous = concrete[index - 1];
		const current = concrete[index];
		if (!previous || !current) continue;
		if (current.from < previous.from) throw new Error('Edit plan changes must be ordered');
		if (current.from < previous.to || current.from === previous.from) {
			throw new Error('Edit plan changes must not overlap');
		}
	}
	return concrete;
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
	if (!region) throw new Error('Edit plan change is outside every verifier-resolved named edit region');
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
	const resolved = input.verifier.verifyAndResolve(
		plan.ownership.capability,
		input.expectedOperation,
		input.expectedScope,
		input.stateSnapshotId,
		input.authoritativeProtectedRanges,
	);
	if (!resolved) throw new Error('Edit plan capability is invalid for the expected operation and scope');
	const changes = inspectChanges(plan.changes, source.length);
	for (const change of changes) {
		authorizeChange(change, resolved.regions, input.authoritativeProtectedRanges);
	}
}

function dispatchValidatedEditPlan(
	view: EditorView,
	expectedOperation: HandledOperationId,
	plan: EditPlan,
): void {
	view.dispatch({
		annotations: [
			structuralEditAnnotation.of(expectedOperation),
			structuralExceptionAnnotation.of(plan.exceptionId),
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

function applyClipboardResult(
	view: EditorView,
	expectedOperation: HandledOperationId,
	expectedScope: EditScope,
	result: Extract<OperationResult, { readonly kind: 'clipboard' }>,
	services: OperationResultServices,
): void {
	services.clipboard.writeText(result.text);
	if (result.edit) {
		validateEditPlan(view.state.doc.toString(), result.edit, {
			...services.validation,
			expectedOperation,
			expectedScope,
		});
	}
	if (result.edit) dispatchValidatedEditPlan(view, expectedOperation, result.edit);
}

function applyHandledResult(
	view: EditorView,
	expectedOperation: HandledOperationId,
	expectedScope: EditScope,
	result: Exclude<OperationResult, { readonly kind: 'pass-through' }>,
	services: OperationResultServices,
): void {
	if (result.kind === 'selection') {
		view.dispatch({ selection: result.selection, scrollIntoView: true });
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
