import {
	EditorState,
	StateEffect,
	StateField,
	type Extension,
	type Transaction,
} from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import {
	excludedSelectionModeForTransaction,
	recognizedNormalSelectionTransaction,
} from './input-state.js';

export type SelectionPresentationPhase = 'idle' | 'dragging' | 'settled' | 'clearing';

export interface SelectionPresentationSession {
	readonly owned: boolean;
	readonly phase: SelectionPresentationPhase;
}

const idleSession: SelectionPresentationSession = { owned: false, phase: 'idle' };
const pointerPressed = StateEffect.define<boolean>();
const beginClearing = StateEffect.define<null>();
const settleSession = StateEffect.define<null>();

const pointerPressedStateField = StateField.define<boolean>({
	create: () => false,
	update(value, transaction) {
		const effect = transaction.effects.find((candidate) => candidate.is(pointerPressed));
		return effect ? effect.value : value;
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

export const selectionPresentationSessionField = StateField.define<SelectionPresentationSession>({
	create: () => idleSession,
	update(value, transaction) {
		if (transaction.effects.some((effect) => effect.is(beginClearing))) {
			return value.owned && canOwnSelection(transaction) ?
				{ owned: true, phase: 'clearing' } : idleSession;
		}
		if (transaction.effects.some((effect) => effect.is(settleSession))) {
			return value.owned && canOwnSelection(transaction) ?
				{ owned: true, phase: 'settled' } : idleSession;
		}
		if (value.owned && !canOwnSelection(transaction)) return idleSession;
		if (!transaction.selection) return value;
		if (!canOwnSelection(transaction)) return idleSession;
		if (transaction.isUserEvent('select.pointer')) {
			return {
				owned: true,
				phase: transaction.startState.field(pointerPressedStateField) ? 'dragging' : 'settled',
			};
		}
		if (recognizedNormalSelectionTransaction(transaction)) {
			return { owned: true, phase: 'settled' };
		}
		if (transaction.newSelection.eq(transaction.startState.selection) || pointerWasPressed(transaction)) {
			return value;
		}
		return idleSession;
	},
});

export function selectionPresentationSession(state: EditorState): SelectionPresentationSession {
	const session = state.field(selectionPresentationSessionField, false);
	if (session === undefined) throw new Error('Selection presentation session is not installed');
	return session;
}

const selectionPresentationSessionPlugin = ViewPlugin.define((view) => {
	const ownerDocument = view.dom.ownerDocument;
	let active = true;
	const onMouseUp = (event: MouseEvent) => {
		if (event.button !== 0 || !view.state.field(pointerPressedStateField)) return;
		queueMicrotask(() => {
			if (!active || !view.state.field(pointerPressedStateField)) return;
			view.dispatch({ effects: [pointerPressed.of(false), settleSession.of(null)] });
		});
	};
	ownerDocument.addEventListener('mouseup', onMouseUp);
	return {
		destroy() {
			active = false;
			ownerDocument.removeEventListener('mouseup', onMouseUp);
		},
	};
}, {
	eventObservers: {
		mousedown(event, view) {
			if (event.button !== 0) return;
			const effects: StateEffect<unknown>[] = [pointerPressed.of(true)];
			if (selectionPresentationSession(view.state).owned) effects.push(beginClearing.of(null));
			view.dispatch({ effects });
		},
	},
});

export function createSelectionPresentationSessionExtension(): Extension {
	return [
		pointerPressedStateField,
		selectionPresentationSessionField,
		selectionPresentationSessionPlugin,
	];
}
