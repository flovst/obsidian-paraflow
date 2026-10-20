import { isolateHistory } from '@codemirror/commands';
import { Transaction, type ChangeSpec, type EditorState, type Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView } from '@codemirror/view';

export interface IndentMaintenanceSaveOptions {
	readonly getEnabled: () => boolean;
	readonly isPrimaryEditor: (view: EditorView) => boolean;
	readonly plan: (state: EditorState) => readonly ChangeSpec[];
	readonly save: (view: EditorView) => Promise<void>;
	readonly onError: (error: unknown) => void;
}

function explicitSaveKey(event: KeyboardEvent): boolean {
	return event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
}

function maintenanceAllowed(view: EditorView, event: KeyboardEvent, options: IndentMaintenanceSaveOptions): boolean {
	return options.getEnabled() && options.isPrimaryEditor(view) && view.hasFocus && !view.state.readOnly &&
		!view.composing && !view.compositionStarted && !event.isComposing && event.composedPath().includes(view.contentDOM);
}

export function createIndentMaintenanceSaveExtension(options: IndentMaintenanceSaveOptions): Extension {
	return ViewPlugin.fromClass(class {
		private readonly window: Window;
		private readonly keydown = (event: KeyboardEvent): void => {
			if (!explicitSaveKey(event) || !maintenanceAllowed(this.view, event, options)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			try {
				const plan = options.plan(this.view.state);
				if (plan.length) {
					const changes = this.view.state.changes(plan);
					this.view.dispatch({ changes,
						annotations: [Transaction.userEvent.of('input.paraflow.indent-maintenance'), isolateHistory.of('full')],
					});
				}
				void options.save(this.view).catch(options.onError);
			} catch (error) { options.onError(error); }
		};

		constructor(private readonly view: EditorView) {
			const window = view.dom.ownerDocument.defaultView;
			if (!window) throw new Error('Editor owner document has no window');
			this.window = window;
			this.window.addEventListener('keydown', this.keydown, true);
		}

		destroy(): void {
			this.window.removeEventListener('keydown', this.keydown, true);
		}
	});
}
