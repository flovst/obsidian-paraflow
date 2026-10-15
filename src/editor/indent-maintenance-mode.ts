import { isolateHistory } from '@codemirror/commands';
import { Transaction, type ChangeSpec, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export interface ModeMaintenanceTarget {
	readonly owner: object;
	readonly file: object;
	readonly editor: EditorView;
	readonly mode: 'source' | 'live-preview' | 'reading';
}

/** Observe completed public layout transitions while the host retains the editor. */
export function createIndentModeMaintenance(options: {
	readonly getTarget: () => ModeMaintenanceTarget | null;
	readonly getEnabled: () => boolean;
	readonly plan: (state: EditorState) => readonly ChangeSpec[];
}): { layoutChanged(): void; reset(): void } {
	let previous = options.getTarget();
	return {
		reset() { previous = options.getTarget(); },
		layoutChanged() {
			const next = options.getTarget(), old = previous;
			previous = next;
			if (!next || !old || old.owner !== next.owner || old.file !== next.file ||
				old.editor !== next.editor || old.mode === next.mode || !options.getEnabled()) return;
			const view = next.editor;
			if (view.state.readOnly || view.composing || view.compositionStarted) return;
			const plan = options.plan(view.state);
			if (!plan.length) return;
			const changes = view.state.changes(plan);
			view.dispatch({ changes, selection: view.state.selection.map(changes),
				annotations: [Transaction.userEvent.of('input.paraflow.indent-maintenance'), isolateHistory.of('full')],
			});
		},
	};
}
