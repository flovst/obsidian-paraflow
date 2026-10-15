import { EditorSelection, Prec, Transaction, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { inlineSemanticConstructAt } from './inline-selection-projection.js';
import { resolvedReferenceLinkAt, type ResolvedReferenceLink } from './literal-reference.js';

export interface LinkInteractionOptions {
	readonly editLinksOnPlainClick: () => boolean;
	readonly isActive: (view: EditorView) => boolean;
	readonly openReferenceLink?: (destination: string, view: EditorView) => void;
}

function isPlainPrimaryButton(event: MouseEvent): boolean {
	return event.button === 0 && !event.altKey && !event.ctrlKey &&
		!event.metaKey && !event.shiftKey;
}

function consume(event: Event): void {
	event.preventDefault();
	event.stopPropagation();
}

function opensReference(event: MouseEvent, options: LinkInteractionOptions): boolean {
	return event.button === 0 && !event.altKey && !event.shiftKey &&
		(event.ctrlKey || event.metaKey || !options.editLinksOnPlainClick());
}

function destinationText(source: string, view: EditorView): string {
	return source.replace(/\\([!-/:-@[-`{-~])|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]+);/gu, (token, escaped: string | undefined) =>
		escaped ?? new view.dom.ownerDocument.defaultView!.DOMParser().parseFromString(token, 'text/html').body.textContent);
}

export function createLinkInteraction(options: LinkInteractionOptions): Extension {
	const pendingClicks = new WeakMap<EditorView, ResolvedReferenceLink | null>();
	return Prec.highest(EditorView.domEventHandlers({
		click(event, view) {
			if (!pendingClicks.has(view)) return false;
			const pending = pendingClicks.get(view);
			pendingClicks.delete(view);
			consume(event);
			if (pending && options.isActive(view) && opensReference(event, options)) {
				const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
				const reference = position === null ? null : resolvedReferenceLinkAt(view.state, position);
				if (reference?.from === pending.from && reference.to === pending.to && reference.destination === pending.destination) {
					options.openReferenceLink!(destinationText(reference.destination, view), view);
				}
			}
			return true;
		},
		mousedown(event, view) {
			pendingClicks.delete(view);
			if (!options.isActive(view)) return false;
			const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
			if (position === null) return false;
			const reference = resolvedReferenceLinkAt(view.state, position);
			if (reference && options.openReferenceLink && opensReference(event, options)) {
				consume(event);
				pendingClicks.set(view, reference);
				return true;
			}
			if (!options.editLinksOnPlainClick() || !isPlainPrimaryButton(event) ||
				(!reference && inlineSemanticConstructAt(view.state, position, 'link') === null)) return false;
			consume(event);
			pendingClicks.set(view, null);
			view.focus();
			view.dispatch({
				annotations: Transaction.userEvent.of('select.pointer'),
				selection: EditorSelection.cursor(position),
			});
			return true;
		},
	}));
}
