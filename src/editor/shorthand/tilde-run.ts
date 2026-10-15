import { Facet, StateField, type EditorState } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';
import { bindRenderedSourceClick } from '../runtime/rendered-source-click.js';
import { discoverTildeRuns, type ShorthandSettings, type TildeRun } from './syntax.js';

export const shorthandSettings = Facet.define<() => ShorthandSettings, (() => ShorthandSettings) | null>({
	combine: values => values[0] ?? null,
});
export const tildeRuns = StateField.define<readonly TildeRun[]>({
	create: state => discoverTildeRuns(state.doc.toString()),
	update: (value, transaction) => transaction.docChanged ? discoverTildeRuns(transaction.newDoc.toString()) : value,
});

export function ownsTildeRun(state: EditorState, from: number, to: number): boolean {
	return Boolean(state.facet(shorthandSettings)?.().subscript &&
		state.field(tildeRuns).some(run => run.from <= from && run.to >= to));
}

/** The whole ambiguous run is one replacement so the host cannot hide a larger delimiter token. */
export class TildeRunWidget extends WidgetType {
	private static readonly cleanups = new WeakMap<HTMLElement, () => void>();
	constructor(readonly run: TildeRun, readonly source: string, readonly isOwnerActive: () => boolean) { super(); }
	eq(other: TildeRunWidget): boolean { return this.run.from === other.run.from && this.source === other.source; }
	toDOM(view: EditorView): HTMLElement {
		const element = view.dom.ownerDocument.createElement('span');
		element.className = 'paraflow-tilde-run';
		const positions = new Map<Node, number>();
		let cursor = this.run.from;
		const append = (from: number, to: number, parent: Node): void => {
			if (from === to) return;
			const text = view.dom.ownerDocument.createTextNode(this.source.slice(from - this.run.from, to - this.run.from));
			positions.set(text, from); parent.appendChild(text);
		};
		for (const part of this.run.parts) {
			append(cursor, part.from, element);
			const body = view.dom.ownerDocument.createElement(part.kind === 'subscript' ? 'sub' : 'del');
			body.className = `paraflow-inline-body--${part.kind}`;
			append(part.bodyFrom, part.bodyTo, body); element.append(body); cursor = part.to;
		}
		append(cursor, this.run.to, element);
		TildeRunWidget.cleanups.set(element, bindRenderedSourceClick(view, element, (node, offset) => {
			const start = positions.get(node); return start === undefined ? null : start + offset;
		}, this.isOwnerActive));
		return element;
	}
	destroy(dom: HTMLElement): void { TildeRunWidget.cleanups.get(dom)!(); TildeRunWidget.cleanups.delete(dom); }
	ignoreEvent(): boolean { return false; }
}
