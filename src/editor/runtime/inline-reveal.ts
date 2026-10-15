import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { classifyCurrentSelectionMode } from './input-state.js';

const setHeld = StateEffect.define<boolean>();
const held = StateField.define<boolean>({
	create: () => false,
	update: (value, transaction) => transaction.effects.find(effect => effect.is(setHeld))?.value ?? value,
});
const pointer = ViewPlugin.define(view => {
	const doc = view.dom.ownerDocument;
	const win = doc.defaultView!;
	let alive = true;
	const cancel = (): void => { if (view.state.field(held)) view.dispatch({ effects: setHeld.of(false) }); };
	const release = (event: MouseEvent): void => {
		if (event.button !== 0) return;
		queueMicrotask(() => {
			if (alive) cancel();
		});
	};
	doc.addEventListener('mouseup', release);
	win.addEventListener('blur', cancel);
	return { destroy() { alive = false; doc.removeEventListener('mouseup', release); win.removeEventListener('blur', cancel); } };
}, { eventObservers: { mousedown(event, view) {
	if (event.button === 0) view.dispatch({ effects: setHeld.of(true) });
} } });

/** Physical button lifetime is independent of document edits and selection provenance. */
export function createInlineRevealPointerExtension(): Extension { return [held, pointer]; }
export function inlineRevealPointerHeld(state: EditorState): boolean { return state.field(held); }

export interface InlineBodyOwner {
	readonly from: number;
	readonly to: number;
	readonly bodies: readonly { readonly from: number; readonly to: number }[];
}

/** Carets own complete syntax; nonempty ranges reveal only their two BODY owners. */
export function inlineEndpointOwners<T extends InlineBodyOwner>(state: EditorState, owners: readonly T[]): readonly T[] {
	const mode = classifyCurrentSelectionMode(state);
	if (mode !== 'caret' && mode !== 'continuous') return [];
	const selection = state.selection.main;
	const active = new Set<T>();
	for (const position of [selection.anchor, selection.head]) {
		const owner = owners.filter(item => item.from <= position && position <= item.to)
			.sort((left, right) => (left.to - left.from) - (right.to - right.from) || right.from - left.from)[0];
		if (owner && (mode === 'caret' || owner.bodies.some(body => body.from <= position && position <= body.to))) active.add(owner);
	}
	return [...active];
}
