import {
	Annotation,
	EditorSelection,
	EditorState,
	Facet,
	StateEffect,
	StateField,
	type Extension,
	type Transaction,
} from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { ContextRuntime, StructuredListRangeIndex } from './model.js';
import type { SelectionMode } from './operations.js';
import { getStructuredListProjectionState } from './projection.js';

export const selectionModeAnnotation = Annotation.define<SelectionMode>();
export const compositionStarted = StateEffect.define<null>();
export const compositionEnded = StateEffect.define<null>();

export const compositionStateField = StateField.define<boolean>({
	create: () => false,
	update(value, transaction) {
		if (transaction.effects.some((effect) => effect.is(compositionStarted))) return true;
		if (transaction.effects.some((effect) => effect.is(compositionEnded))) return false;
		return value;
	},
});

const modePriority: Readonly<Record<SelectionMode, number>> = {
	column: 3,
	normal: 0,
	'third-party': 4,
	'whole-document': 1,
	'whole-item': 2,
};

type ExcludedSelectionMode = Exclude<SelectionMode, 'normal'>;

function highestPriorityMode(modes: readonly ExcludedSelectionMode[]): ExcludedSelectionMode;
function highestPriorityMode(modes: readonly SelectionMode[]): SelectionMode;
function highestPriorityMode(modes: readonly SelectionMode[]): SelectionMode {
	return modes.reduce((selected, candidate) =>
		modePriority[candidate] > modePriority[selected] ? candidate : selected, 'normal');
}

export const activeSelectionModeFacet = Facet.define<SelectionMode, SelectionMode>({
	combine: highestPriorityMode,
});

type SelectionModeClassifier = (transaction: Transaction) => ExcludedSelectionMode | null;

export const selectionModeClassifierFacet = Facet.define<
	SelectionModeClassifier,
	readonly SelectionModeClassifier[]
>({
	combine: (classifiers) => classifiers,
});

function isExcludedMode(mode: SelectionMode | null | undefined): mode is ExcludedSelectionMode {
	return mode !== null && mode !== undefined && mode !== 'normal';
}

const excludedTransactionModes = new WeakMap<Transaction, ExcludedSelectionMode | null>();

function transactionClassifierModes(transaction: Transaction): readonly ExcludedSelectionMode[] {
	const classifiers = new Set([
		...transaction.startState.facet(selectionModeClassifierFacet),
		...transaction.state.facet(selectionModeClassifierFacet),
	]);
	return [...classifiers].map((classify) => classify(transaction)).filter(isExcludedMode);
}

function resolveExcludedTransactionMode(transaction: Transaction): ExcludedSelectionMode | null {
	const modes = [
		transaction.annotation(selectionModeAnnotation),
		transaction.startState.facet(activeSelectionModeFacet),
		transaction.state.facet(activeSelectionModeFacet),
		...transactionClassifierModes(transaction),
	].filter(isExcludedMode);
	if (modes.length === 0) return null;
	return highestPriorityMode(modes);
}

function excludedTransactionMode(transaction: Transaction): ExcludedSelectionMode | null {
	const cached = excludedTransactionModes.get(transaction);
	if (cached !== undefined) return cached;
	const winner = resolveExcludedTransactionMode(transaction);
	excludedTransactionModes.set(transaction, winner);
	return winner;
}

function transactionProvenance(transaction: Transaction): SelectionMode | 'unknown' {
	const excluded = excludedTransactionMode(transaction);
	if (excluded) return excluded;
	const annotated = transaction.annotation(selectionModeAnnotation);
	if (annotated === 'normal') return annotated;
	return transaction.isUserEvent('select') ? 'normal' : 'unknown';
}

export const selectionProvenanceStateField = StateField.define<SelectionMode | 'unknown'>({
	create: () => 'unknown',
	update(value, transaction) {
		return transaction.selection ? transactionProvenance(transaction) : value;
	},
});

function exactWholeDocument(state: EditorState): boolean {
	const selection = state.selection;
	return selection.ranges.length === 1 &&
		!selection.main.empty &&
		selection.main.from === 0 &&
		selection.main.to === state.doc.length;
}

export function classifyCurrentSelectionMode(state: EditorState): ContextRuntime['selectionMode'] {
	if (state.selection.ranges.length !== 1) return 'unknown';
	const active = state.facet(activeSelectionModeFacet);
	const provenance = state.field(selectionProvenanceStateField, false) ?? 'unknown';
	const excluded = [active, provenance === 'unknown' ? null : provenance].filter(isExcludedMode);
	if (excluded.length > 0) return highestPriorityMode(excluded);
	if (exactWholeDocument(state)) return 'whole-document';
	if (provenance !== 'normal') return provenance;
	return state.selection.main.empty ? 'caret' : 'continuous';
}

function recognizedNormal(transaction: Transaction): boolean {
	return transaction.annotation(selectionModeAnnotation) === 'normal' ||
		transaction.isUserEvent('select');
}

function sharedProtectedBoundary(
	rangeIndex: StructuredListRangeIndex,
	anchor: number,
	head: number,
): number | null {
	const anchorRange = rangeIndex.containing(anchor);
	const headRange = rangeIndex.containing(head);
	return anchorRange && headRange &&
		anchorRange.from === headRange.from && anchorRange.to === headRange.to
		? anchorRange.to
		: null;
}

function mappedSelection(transaction: Transaction): EditorSelection | null {
	const rangeIndex = getStructuredListProjectionState(transaction.state)?.rangeIndex;
	if (!rangeIndex) return null;
	const { anchor, head } = transaction.newSelection.main;
	if (anchor === head) {
		const position = rangeIndex.mapEndpoint(anchor, 1);
		return EditorSelection.single(position);
	}
	const sharedBoundary = sharedProtectedBoundary(rangeIndex, anchor, head);
	if (sharedBoundary !== null) return EditorSelection.single(sharedBoundary);
	const direction = anchor < head ? 1 : -1;
	return EditorSelection.single(
		rangeIndex.mapEndpoint(anchor, direction),
		rangeIndex.mapEndpoint(head, direction === 1 ? -1 : 1),
	);
}

function compositionActive(transaction: Transaction): boolean {
	return (transaction.startState.field(compositionStateField, false) ?? false) ||
		(transaction.state.field(compositionStateField, false) ?? false);
}

function geometryExcluded(transaction: Transaction): boolean {
	return transaction.newSelection.ranges.length !== 1 || exactWholeDocument(transaction.state);
}

function selectionModeExcluded(transaction: Transaction): boolean {
	return excludedTransactionMode(transaction) !== null;
}

function selectionFilter(
	transaction: Transaction,
	isLivePreview: (state: EditorState) => boolean,
) {
	if (!isLivePreview(transaction.startState)) return transaction;
	if (compositionActive(transaction) || geometryExcluded(transaction)) return transaction;
	if (selectionModeExcluded(transaction)) return transaction;
	if (!recognizedNormal(transaction)) return transaction;
	const selection = mappedSelection(transaction);
	return selection ? [transaction, { selection, sequential: true }] : transaction;
}

const compositionPlugin = ViewPlugin.define(() => ({}), {
	eventHandlers: {
		compositionend(_event, view) {
			view.dispatch({ effects: compositionEnded.of(null) });
			return false;
		},
		compositionstart(_event, view) {
			view.dispatch({ effects: compositionStarted.of(null) });
			return false;
		},
	},
});

export interface SelectionProtectionOptions {
	readonly isLivePreview: (state: EditorState) => boolean;
}

export function createSelectionProtection(options: SelectionProtectionOptions): Extension {
	return [
		compositionStateField,
		selectionProvenanceStateField,
		EditorState.transactionFilter.of((transaction) =>
			selectionFilter(transaction, options.isLivePreview)),
		compositionPlugin,
	];
}
