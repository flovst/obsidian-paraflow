import {
	EditorSelection,
	EditorState,
	Facet,
	StateEffect,
	StateField,
	Transaction,
	type Extension,
} from '@codemirror/state';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import {
	excludedSelectionModeForTransaction,
	recognizedNormalSelectionTransaction,
} from './input-state.js';

export type SelectionPresentationPhase =
	| 'idle'
	| 'dragging'
	| 'settled'
	| 'clearing'
	| 'releasing';

export interface SelectionPresentationSession {
	readonly owned: boolean;
	readonly phase: SelectionPresentationPhase;
	readonly projectionCoverage: EditorSelection | null;
}

function createSession(
	owned: boolean,
	phase: SelectionPresentationPhase,
	projectionCoverage: EditorSelection | null,
): SelectionPresentationSession {
	const session = { owned, phase } as SelectionPresentationSession;
	Object.defineProperty(session, 'projectionCoverage', {
		enumerable: false,
		value: projectionCoverage,
	});
	return Object.freeze(session);
}

const idleSession = createSession(false, 'idle', null);
const pointerPressed = StateEffect.define<boolean>();
const beginClearing = StateEffect.define<EditorSelection>();
const beginRelease = StateEffect.define<null>();
const settleSession = StateEffect.define<null>();
const viewPresentationActive = StateEffect.define<boolean>();
/** A rendered-source hit begins a fresh native mouse selection at its exact source offset. */
export const beginSourcePointer = StateEffect.define<null>();
type PointerReleaseReconciliation = 'idle' | 'awaiting-echo' | 'echoed';
type SelectionPresentationStatePredicate = (state: EditorState) => boolean;
type SelectionPresentationViewPredicate = (view: EditorView) => boolean;

const selectionPresentationStatePredicates = Facet.define<
	SelectionPresentationStatePredicate,
	readonly SelectionPresentationStatePredicate[]
>({
	combine: (predicates) => [...new Set(predicates)],
});

const selectionPresentationViewPredicates = Facet.define<
	SelectionPresentationViewPredicate,
	readonly SelectionPresentationViewPredicate[]
>({
	combine: (predicates) => [...new Set(predicates)],
});

const selectionPresentationViewActiveField = StateField.define<boolean>({
	create: (state) => state.facet(selectionPresentationViewPredicates).length === 0,
	update(value, transaction) {
		if (transaction.reconfigured && transaction.startState.facet(selectionPresentationViewPredicates) !==
			transaction.state.facet(selectionPresentationViewPredicates)) {
			return transaction.state.facet(selectionPresentationViewPredicates).length === 0;
		}
		const effect = transaction.effects.find((candidate) =>
			candidate.is(viewPresentationActive));
		return effect ? effect.value : value;
	},
});

function isSelectionPresentationStateActive(state: EditorState): boolean {
	return state.field(selectionPresentationViewActiveField) &&
		state.facet(selectionPresentationStatePredicates).every((predicate) => predicate(state));
}

function isSelectionPresentationViewActive(view: EditorView): boolean {
	return view.state.facet(selectionPresentationViewPredicates)
		.every((predicate) => predicate(view));
}

const pointerPressedStateField = StateField.define<boolean>({
	create: () => false,
	update(value, transaction) {
		if (transaction.effects.some(effect => effect.is(beginSourcePointer))) return true;
		if (transaction.docChanged || transaction.reconfigured ||
			!isSelectionPresentationStateActive(transaction.state)) return false;
		const effect = transaction.effects.find((candidate) => candidate.is(pointerPressed));
		const next = effect ? effect.value : value;
		if (!next || transaction.selection === undefined) return next;
		const session = transaction.startState.field(selectionPresentationSessionField, false);
		if (transaction.isUserEvent('select.pointer')) {
			return canOwnSelection(transaction) || (transaction.newSelection.ranges.length === 1 &&
				transaction.newSelection.main.empty &&
				excludedSelectionModeForTransaction(transaction) === null) ||
				(session?.phase === 'clearing' && isClearingPointerCollapse(transaction));
		}
		if (isUnannotatedSelection(transaction)) {
			return session?.owned === true &&
				(session.phase === 'dragging' || session.phase === 'clearing') &&
				canOwnSelection(transaction);
		}
		return false;
	},
});

function isUnannotatedSelection(transaction: Transaction): boolean {
	return transaction.selection !== undefined &&
		transaction.annotation(Transaction.userEvent) === undefined;
}

function isSameAnchorEndpointCorrection(transaction: Transaction): boolean {
	const before = transaction.startState.selection;
	const after = transaction.newSelection;
	if (before.ranges.length !== 1 || after.ranges.length !== 1) return false;
	const previous = before.main;
	const next = after.main;
	if (previous.empty || next.empty || previous.anchor !== next.anchor ||
		previous.head === next.head) return false;
	return previous.head > previous.anchor
		? next.head > next.anchor
		: next.head < next.anchor;
}

const pointerReleaseReconciliationField = StateField.define<PointerReleaseReconciliation>({
	create: () => 'idle',
	update(value, transaction) {
		if (transaction.effects.some((effect) =>
			effect.is(beginClearing) || effect.is(beginRelease) ||
			(effect.is(pointerPressed) && effect.value))) {
			return 'idle';
		}
		if (transaction.effects.some((effect) => effect.is(settleSession))) {
			return canOwnSelection(transaction) ? 'awaiting-echo' : 'idle';
		}
		if (value === 'idle' || transaction.docChanged || !isUnannotatedSelection(transaction)) {
			return 'idle';
		}
		if (value === 'awaiting-echo' &&
			transaction.newSelection.eq(transaction.startState.selection)) {
			return 'echoed';
		}
		return 'idle';
	},
});

function isWholeDocumentSelection(state: EditorState): boolean {
	const { main, ranges } = state.selection;
	return ranges.length === 1 && !main.empty && main.from === 0 && main.to === state.doc.length;
}

function canOwnSelection(transaction: Transaction): boolean {
	return transaction.newSelection.ranges.length === 1 &&
		!transaction.newSelection.main.empty &&
		!isWholeDocumentSelection(transaction.state) &&
		excludedSelectionModeForTransaction(transaction) === null;
}

function pointerWasPressed(transaction: Transaction): boolean {
	return transaction.startState.field(pointerPressedStateField);
}

function isPointerReleaseEndpointCorrection(transaction: Transaction): boolean {
	return transaction.startState.field(pointerReleaseReconciliationField) === 'echoed' &&
		!transaction.docChanged &&
		isUnannotatedSelection(transaction) &&
		isSameAnchorEndpointCorrection(transaction);
}

function isClearingPointerCollapse(transaction: Transaction): boolean {
	return !transaction.docChanged &&
		pointerWasPressed(transaction) &&
		transaction.selection !== undefined &&
		transaction.isUserEvent('select.pointer') &&
		transaction.newSelection.ranges.length === 1 &&
		transaction.newSelection.main.empty &&
		excludedSelectionModeForTransaction(transaction) === null;
}

function isClearingPointerContinuation(transaction: Transaction): boolean {
	return isClearingPointerCollapse(transaction) ||
		(pointerWasPressed(transaction) && canOwnSelection(transaction) &&
			(transaction.isUserEvent('select.pointer') || isUnannotatedSelection(transaction)));
}

function isPointerReleaseTail(transaction: Transaction): boolean {
	if (transaction.selection === undefined) return true;
	return transaction.newSelection.ranges.length === 1 &&
		excludedSelectionModeForTransaction(transaction) === null &&
		(transaction.isUserEvent('select.pointer') || isUnannotatedSelection(transaction));
}

export const selectionPresentationSessionField = StateField.define<SelectionPresentationSession>({
	create: () => idleSession,
	update(value, transaction) {
		if (transaction.effects.some(effect => effect.is(beginSourcePointer))) return idleSession;
		if (transaction.docChanged || transaction.reconfigured ||
			!isSelectionPresentationStateActive(transaction.state)) return idleSession;
		const clearing = transaction.effects.find((effect) => effect.is(beginClearing));
		if (clearing) {
			return clearing.value.ranges.some(({ empty }) => !empty)
				? createSession(true, 'clearing', clearing.value)
				: idleSession;
		}
		if (transaction.effects.some((effect) => effect.is(beginRelease))) {
			return value.owned
				? createSession(true, 'releasing', value.projectionCoverage)
				: idleSession;
		}
		if (transaction.effects.some((effect) => effect.is(settleSession))) {
			return value.owned && value.phase === 'releasing' && canOwnSelection(transaction) ?
				createSession(true, 'settled', transaction.newSelection) : idleSession;
		}
		if (value.owned && value.phase === 'releasing') {
			return isPointerReleaseTail(transaction) ? value : idleSession;
		}
		if (value.owned && value.phase === 'clearing' &&
			isClearingPointerContinuation(transaction)) {
			return value;
		}
		if (value.owned && !canOwnSelection(transaction)) return idleSession;
		if (!transaction.selection) return value;
		if (!canOwnSelection(transaction)) return idleSession;
		if (transaction.isUserEvent('select.pointer')) {
			if (!pointerWasPressed(transaction)) return idleSession;
			return createSession(
				true,
				'dragging',
				transaction.newSelection,
			);
		}
		if (recognizedNormalSelectionTransaction(transaction)) {
			return createSession(true, 'settled', transaction.newSelection);
		}
		if (value.owned && value.phase === 'settled' &&
			isPointerReleaseEndpointCorrection(transaction)) {
			return createSession(true, 'settled', transaction.newSelection);
		}
		if (transaction.newSelection.eq(transaction.startState.selection)) return value;
		if (value.owned && value.phase === 'dragging' && pointerWasPressed(transaction) &&
			isUnannotatedSelection(transaction)) {
			return createSession(true, value.phase, transaction.newSelection);
		}
		return idleSession;
	},
});

export function selectionPresentationSession(state: EditorState): SelectionPresentationSession {
	const session = state.field(selectionPresentationSessionField, false);
	if (session === undefined) throw new Error('Selection presentation session is not installed');
	return session;
}

export function selectionProjectionCoverage(state: EditorState): EditorSelection | null {
	const session = state.field(selectionPresentationSessionField, false);
	if (session?.projectionCoverage) return session.projectionCoverage;
	if (!session) return null;
	return state.selection.ranges.some(({ empty }) => !empty) ? state.selection : null;
}

export function selectionPointerPressed(state: EditorState): boolean {
	return state.field(pointerPressedStateField, false) ?? false;
}

const selectionPresentationSessionPlugin = ViewPlugin.define((view) => {
	const ownerDocument = view.dom.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	let alive = true;
	let presentationActive = isSelectionPresentationViewActive(view);
	let releaseFrame: number | null = null;
	const cancelReleaseFrame = (): void => {
		if (releaseFrame === null || !ownerWindow) return;
		ownerWindow.cancelAnimationFrame(releaseFrame);
		releaseFrame = null;
	};
	const queueReleaseCommit = (): void => {
		if (!ownerWindow) throw new Error('Selection presentation requires a window');
		cancelReleaseFrame();
		releaseFrame = ownerWindow.requestAnimationFrame(() => {
			releaseFrame = null;
			if (!alive || view.state.field(selectionPresentationSessionField, false) === undefined) {
				return;
			}
			if (view.state.field(pointerPressedStateField)) return;
			view.dispatch({
				annotations: Transaction.userEvent.of('select.pointer'),
				effects: settleSession.of(null),
				selection: view.state.selection,
			});
		});
	};
	const queueViewActivity = (active: boolean): void => {
		queueMicrotask(() => {
			if (!alive || view.state.field(selectionPresentationViewActiveField, false) === undefined ||
				view.state.field(selectionPresentationViewActiveField) === active) return;
			view.dispatch({
				effects: active
					? viewPresentationActive.of(true)
					: [viewPresentationActive.of(false), pointerPressed.of(false)],
			});
		});
	};
	if (view.state.facet(selectionPresentationViewPredicates).length > 0) {
		queueViewActivity(presentationActive);
	}
	const releasePointer = () => {
		if (!view.state.field(pointerPressedStateField)) return;
		queueMicrotask(() => {
			if (!alive || !view.state.field(pointerPressedStateField)) return;
			view.dispatch({ effects: [pointerPressed.of(false), beginRelease.of(null)] });
			queueReleaseCommit();
		});
	};
	const onMouseUp = (event: MouseEvent) => {
		if (event.button === 0) releasePointer();
	};
	ownerDocument.addEventListener('mouseup', onMouseUp);
	ownerDocument.addEventListener('pointercancel', releasePointer);
	ownerWindow?.addEventListener('blur', releasePointer);
	return {
		update() {
			const usesViewGate = view.state.facet(selectionPresentationViewPredicates).length > 0;
			const nextActive = isSelectionPresentationViewActive(view);
			if (usesViewGate && (presentationActive !== nextActive ||
				view.state.field(selectionPresentationViewActiveField) !== nextActive)) {
				queueViewActivity(nextActive);
			}
			presentationActive = nextActive;
		},
		destroy() {
			alive = false;
			cancelReleaseFrame();
			ownerDocument.removeEventListener('mouseup', onMouseUp);
			ownerDocument.removeEventListener('pointercancel', releasePointer);
			ownerWindow?.removeEventListener('blur', releasePointer);
		},
	};
}, {
	eventObservers: {
		mousedown(event, view) {
			if (event.button !== 0) return;
			const active = isSelectionPresentationViewActive(view);
			const effects: StateEffect<unknown>[] = [
				viewPresentationActive.of(active),
				pointerPressed.of(active),
			];
			if (active) {
				const coverage = selectionProjectionCoverage(view.state);
				if (coverage) effects.push(beginClearing.of(coverage));
			}
			view.dispatch({ effects });
		},
	},
});

export interface SelectionPresentationSessionExtensionOptions {
	readonly isActiveState?: SelectionPresentationStatePredicate;
	readonly isActiveView?: (view: EditorView) => boolean;
}

export function createSelectionPresentationSessionExtension(
	options: SelectionPresentationSessionExtensionOptions = {},
): Extension {
	return [
		...(options.isActiveState
			? [selectionPresentationStatePredicates.of(options.isActiveState)]
			: []),
		...(options.isActiveView
			? [selectionPresentationViewPredicates.of(options.isActiveView)]
			: []),
		pointerPressedStateField,
		pointerReleaseReconciliationField,
		selectionPresentationViewActiveField,
		selectionPresentationSessionField,
		selectionPresentationSessionPlugin,
	];
}
