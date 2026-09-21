import { EditorSelection, Prec, Transaction, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { inlineSemanticConstructAt } from './inline-selection-projection.js';

export interface LinkInteractionOptions {
	readonly editLinksOnPlainClick: () => boolean;
	readonly isActive: (view: EditorView) => boolean;
}

function isPlainPrimaryButton(event: MouseEvent): boolean {
	return event.button === 0 && !event.altKey && !event.ctrlKey &&
		!event.metaKey && !event.shiftKey;
}

function consume(event: Event): void {
	event.preventDefault();
	event.stopPropagation();
}

export function createLinkInteraction(options: LinkInteractionOptions): Extension {
	const pendingClicks = new WeakSet<EditorView>();
	return Prec.highest(EditorView.domEventHandlers({
		click(event, view) {
			if (!pendingClicks.delete(view)) return false;
			consume(event);
			return true;
		},
		mousedown(event, view) {
			pendingClicks.delete(view);
			if (!options.isActive(view) || !options.editLinksOnPlainClick() ||
				!isPlainPrimaryButton(event)) return false;
			const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
			if (position === null ||
				inlineSemanticConstructAt(view.state, position, 'link') === null) return false;
			consume(event);
			pendingClicks.add(view);
			view.focus();
			view.dispatch({
				annotations: Transaction.userEvent.of('select.pointer'),
				selection: EditorSelection.cursor(position),
			});
			return true;
		},
	}));
}
