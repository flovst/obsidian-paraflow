import {
	Annotation,
	EditorState,
	Facet,
	StateEffect,
	StateField,
	type Extension,
	Transaction,
} from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';

export type SelectionMode =
	| 'normal'
	| 'whole-item'
	| 'whole-document'
	| 'column'
	| 'third-party';

export type CurrentSelectionMode =
	| 'caret'
	| 'continuous'
	| 'unknown'
	| Exclude<SelectionMode, 'normal'>;

type ExcludedSelectionMode = Exclude<SelectionMode, 'normal'>;
type SelectionModeClassifier = (transaction: Transaction) => ExcludedSelectionMode | null;

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

export function requireCompositionState(state: EditorState): boolean {
	const composing = state.field(compositionStateField, false);
	if (composing === undefined) throw new Error('Editor composition state is not installed');
	return composing;
}

const modePriority: Readonly<Record<SelectionMode, number>> = {
	column: 3,
	normal: 0,
	'third-party': 4,
	'whole-document': 1,
	'whole-item': 2,
};

function highestPriorityMode(modes: readonly ExcludedSelectionMode[]): ExcludedSelectionMode;
function highestPriorityMode(modes: readonly SelectionMode[]): SelectionMode;
function highestPriorityMode(modes: readonly SelectionMode[]): SelectionMode {
	return modes.reduce((selected, candidate) =>
		modePriority[candidate] > modePriority[selected] ? candidate : selected, 'normal');
}

export const activeSelectionModeFacet = Facet.define<SelectionMode, SelectionMode>({
	combine: highestPriorityMode,
});

export const selectionModeClassifierFacet = Facet.define<
	SelectionModeClassifier,
	readonly SelectionModeClassifier[]
>({
	combine: (classifiers) => classifiers,
});

export const selectionModeAnnotation = Annotation.define<SelectionMode>();

/** Native keyboard extension must cross hidden gaps in the head's movement direction. */
export function selectionHeadMovementBias(transaction: Transaction): -1 | 1 | null {
	if (transaction.docChanged || transaction.annotation(Transaction.userEvent) !== 'select') return null;
	const before = transaction.startState.selection;
	const after = transaction.newSelection;
	if (before.ranges.length !== 1 || after.ranges.length !== 1 ||
		before.main.anchor !== after.main.anchor || before.main.head === after.main.head) return null;
	return after.main.head < before.main.head ? -1 : 1;
}

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

export function excludedSelectionModeForTransaction(
	transaction: Transaction,
): ExcludedSelectionMode | null {
	const cached = excludedTransactionModes.get(transaction);
	if (cached !== undefined) return cached;
	const winner = resolveExcludedTransactionMode(transaction);
	excludedTransactionModes.set(transaction, winner);
	return winner;
}

const trustedNormalUserEvents = new Set([
	'delete',
	'delete.backward',
	'delete.cut',
	'delete.dedent',
	'delete.forward',
	'delete.line',
	'delete.selection',
	'indent',
	'input',
	'input.complete',
	'input.copyline',
	'input.drop',
	'input.indent',
	'input.paste',
	'input.type',
	'input.type.compose',
	'input.type.compose.start',
	'move',
	'move.character',
	'move.drop',
	'move.line',
	'select',
	'select.pointer',
	'select.redo',
	'select.undo',
	'undo',
	'redo',
]);

const trustedSelectionUserEvents = new Set([
	'select',
	'select.pointer',
	'select.redo',
	'select.undo',
]);

function hasTrustedUserEvent(transaction: Transaction, events: ReadonlySet<string>): boolean {
	const event = transaction.annotation(Transaction.userEvent);
	return event !== undefined && events.has(event);
}

function transactionProvenance(transaction: Transaction): SelectionMode | 'unknown' {
	const excluded = excludedSelectionModeForTransaction(transaction);
	if (excluded) return excluded;
	const annotated = transaction.annotation(selectionModeAnnotation);
	if (annotated === 'normal') return annotated;
	return hasTrustedUserEvent(transaction, trustedNormalUserEvents) ? 'normal' : 'unknown';
}

export const selectionProvenanceStateField = StateField.define<SelectionMode | 'unknown'>({
	create: () => 'unknown',
	update(value, transaction) {
		if (!transaction.selection) return value;
		const provenance = transactionProvenance(transaction);
		return provenance === 'unknown' && value === 'normal' &&
			transaction.newSelection.eq(transaction.startState.selection)
			? value
			: provenance;
	},
});

function exactWholeDocument(state: EditorState): boolean {
	const selection = state.selection;
	return selection.ranges.length === 1 &&
		!selection.main.empty &&
		selection.main.from === 0 &&
		selection.main.to === state.doc.length;
}

export function classifyCurrentSelectionMode(state: EditorState): CurrentSelectionMode {
	const provenance = state.field(selectionProvenanceStateField);
	if (state.selection.ranges.length !== 1) return 'unknown';
	const active = state.facet(activeSelectionModeFacet);
	const excluded = [active, provenance === 'unknown' ? null : provenance].filter(isExcludedMode);
	if (excluded.length > 0) return highestPriorityMode(excluded);
	if (exactWholeDocument(state)) return 'whole-document';
	if (provenance !== 'normal') return provenance;
	return state.selection.main.empty ? 'caret' : 'continuous';
}

export function recognizedNormalSelectionTransaction(transaction: Transaction): boolean {
	return transaction.annotation(selectionModeAnnotation) === 'normal' ||
		hasTrustedUserEvent(transaction, trustedSelectionUserEvents);
}

const compositionPlugin = ViewPlugin.define(() => ({destroyed:false,destroy(){this.destroyed=true;}}), {
	eventHandlers: {
		compositionend(_event, view) {
			// Native CM queues its final DOM flush before invoking custom handlers.
			// A synchronous redraw here can overwrite that still-pending composition commit.
			queueMicrotask(()=>{if(!this.destroyed&&!view.compositionStarted&&view.state.field(compositionStateField,false))view.dispatch({effects:compositionEnded.of(null)});});
			return false;
		},
		compositionstart(_event, view) {
			view.dispatch({ effects: compositionStarted.of(null) });
			return false;
		},
	},
});

export function createInputStateExtension(): Extension {
	return [compositionStateField, selectionProvenanceStateField, compositionPlugin];
}
