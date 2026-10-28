import type { EditorView } from '@codemirror/view';
import type { Scope } from 'obsidian';

export type RegisterBlockMoveScope = (view: EditorView, handle: (event: KeyboardEvent) => boolean) => () => void;

/** Body and table child scopes hand off at focus boundaries, before host editor commands run. */
export function bindBlockMoveScope(
	view: EditorView,
	resolve: () => { owner: { scope: Scope | null }; scope: Scope } | null,
	handle: (event: KeyboardEvent) => boolean,
): () => void {
	let active: { owner: { scope: Scope | null }; scope: Scope; previous: Scope | null; release: () => void } | null = null;
	let destroyed = false;
	const release = () => {
		if (!active) return;
		active.release();
		if (active.owner.scope === active.scope) active.owner.scope = active.previous;
		active = null;
	};
	const refresh = () => {
		if (destroyed) return;
		if (view.dom.ownerDocument.activeElement !== view.contentDOM) { release(); return; }
		if (active) return;
		const binding = resolve();
		if (!binding) return;
		const { owner, scope } = binding, previous = owner.scope;
		const registration = scope.register(null, null, event => {
			if (view.dom.ownerDocument.activeElement !== view.contentDOM || !handle(event)) return undefined;
			event.preventDefault(); return false;
		});
		active = { owner, scope, previous, release: () => scope.unregister(registration) };
		owner.scope = scope;
	};
	const focus = () => {
		// Release synchronously before a cell binds its scope; acquire after that cell releases.
		if (view.dom.ownerDocument.activeElement !== view.contentDOM) release();
		queueMicrotask(refresh);
	};
	view.dom.addEventListener('focusin', focus, true);
	view.dom.addEventListener('focusout', focus, true);
	queueMicrotask(refresh);
	return () => {
		destroyed = true;
		view.dom.removeEventListener('focusin', focus, true);
		view.dom.removeEventListener('focusout', focus, true);
		release();
	};
}
