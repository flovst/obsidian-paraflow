import { createDetachedEl } from '../../dom';
import { Facet, type EditorState } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { quoteContainers, type CalloutCard } from './presentation-model.js';
import { listBlockInset } from '../paragraph/list-block-geometry.js';

/** The container owner supplies the same frame to source rows and replacement blocks. */
export const containerPresentation = Facet.define<{
	readonly isActive: (view: EditorView) => boolean;
	readonly isActiveState?: (state: EditorState) => boolean;
}>();

export function containerRailTails(cards: readonly CalloutCard[], to: number): readonly number[] {
	return cards.map((_card, index) => cards.slice(0, index).filter(card => card.kind === 'callout' && card.to === to).length);
}

export class ContainerRails extends WidgetType {
	constructor(readonly cards: readonly CalloutCard[], readonly tails: readonly number[], readonly row?: { from: number; to: number }) { super(); }
	eq(other: ContainerRails): boolean {
		return this.cards.length === other.cards.length && this.cards.every((card, index) => {
			const candidate = other.cards[index]!;
			return (card.from === this.row?.from) === (candidate.from === other.row?.from) && (card.to === this.row?.to) === (candidate.to === other.row?.to) && card.kind === candidate.kind && card.depth === candidate.depth && card.listDepth === candidate.listDepth && card.listTask === candidate.listTask && card.listOrderedTask === candidate.listOrderedTask && card.type === candidate.type && card.metadata === candidate.metadata && this.tails[index] === other.tails[index];
		});
	}
	toDOM(view: EditorView): HTMLElement {
		const container = createDetachedEl(view.dom.ownerDocument, 'span');
		container.className = 'paraflow-callout-rails'; container.setAttribute('aria-hidden', 'true');
		for (const [index, card] of this.cards.entries()) {
			const rail = createDetachedEl(container.ownerDocument, 'span');
			rail.className = `paraflow-callout-rail${card.kind === 'callout' ? ' callout' : ' paraflow-quote-rail'}`;
			rail.dataset.callout = card.type; rail.dataset.calloutMetadata = card.metadata;
			if (card.from === this.row?.from) rail.dataset.paraflowRailStart = 'true';
			if (card.to === this.row?.to) rail.dataset.paraflowRailEnd = 'true';
			rail.style.setProperty('--paraflow-callout-rail-depth', String(card.depth - 1));
			rail.style.setProperty('--paraflow-rail-callouts', String(this.cards.slice(0, index).filter(ancestor => ancestor.kind === 'callout').length));
			rail.style.setProperty('--paraflow-callout-list-inset', listBlockInset(card.listDepth ?? 0, card.listTask, card.listOrderedTask));
			rail.style.setProperty('--paraflow-callout-rail-tail', String(this.tails[index])); container.append(rail);
		}
		return container;
	}
	ignoreEvent(): boolean { return true; }
}

export interface ContainerFrame { readonly rails: ContainerRails; readonly ends: number; readonly key: string; }

export function containerBlockFrame(state: EditorState, from: number, to: number): ContainerFrame | null {
	if (!state.facet(containerPresentation).some(owner => owner.isActiveState?.(state) !== false)) return null;
	const cards = quoteContainers(state).filter(card => card.from <= from && card.to >= to);
	if (!cards.length) return null;
	const tails = containerRailTails(cards, to), ends = cards.filter(card => card.kind === 'callout' && card.to === to).length;
	return { rails: new ContainerRails(cards, tails, { from, to }), ends,
		key: JSON.stringify([cards.map(card => [card.kind, card.depth, card.listDepth, card.listTask, card.listOrderedTask, card.type, card.metadata]), tails, ends]) };
}

/** Keep the render target separate: async render failures may clear its children. */
export function wrapContainerBlock(view: EditorView, content: HTMLElement, frame: ContainerFrame | null): HTMLElement {
	if (!frame || !view.state.facet(containerPresentation).some(owner => owner.isActive(view))) return content;
	const wrapper = createDetachedEl(content.ownerDocument, 'div'); wrapper.className = 'paraflow-container-block';
	if (frame.rails.cards.at(-1)!.kind === 'quote') wrapper.classList.add('paraflow-quote-block');
	wrapper.contentEditable = 'false'; wrapper.dataset.paraflowContainerFrame = frame.key;
	wrapper.style.setProperty('--paraflow-callout-depth', String(frame.rails.cards.at(-1)!.depth - 1));
	wrapper.style.setProperty('--paraflow-callout-list-inset', listBlockInset(frame.rails.cards.at(-1)!.listDepth ?? 0, frame.rails.cards.at(-1)!.listTask, frame.rails.cards.at(-1)!.listOrderedTask));
	wrapper.style.setProperty('--paraflow-container-callouts', String(frame.rails.cards.filter(card => card.kind === 'callout').length));
	wrapper.style.setProperty('--paraflow-callout-ends', String(frame.ends));
	wrapper.append(frame.rails.toDOM(view), content); return wrapper;
}

export const containerInset = 'calc(var(--paraflow-callout-list-inset, 0px) + var(--paraflow-container-callouts) * var(--paraflow-callout-inset, 24px) + (var(--paraflow-callout-depth) + 1 - var(--paraflow-container-callouts)) * var(--paraflow-quote-inset, 24px))';

export const containerSurfaceStyles = {
	'.markdown-source-view.mod-cm6 & .cm-content > .paraflow-container-block, .cm-content > .paraflow-container-block': { contain: 'none !important' },
	'.paraflow-callout-rails': { position: 'absolute', inset: '0', pointerEvents: 'none' },
	'.paraflow-callout-rails > .paraflow-callout-rail': { display: 'block', position: 'absolute',
		insetInlineStart: 'calc(var(--paraflow-callout-list-inset, 0px) + var(--paraflow-rail-callouts) * var(--paraflow-callout-inset, 24px) + (var(--paraflow-callout-rail-depth) - var(--paraflow-rail-callouts)) * var(--paraflow-quote-inset, 24px))', top: '0',
		bottom: 'calc(var(--paraflow-callout-rail-tail) * var(--paraflow-callout-padding, 12px))', width: '4px',
		padding: '0 !important', margin: '0 !important', border: '0 !important', borderRadius: '0', background: 'var(--callout-color)' },
	'.paraflow-callout-rails > .paraflow-quote-rail': { width: 'max(4px, var(--paraflow-quote-border-width, 4px))', background: 'var(--paraflow-quote-border, var(--background-modifier-border))' },
	'.cm-content > .paraflow-container-block': { position: 'relative', boxSizing: 'border-box', margin: '0', overflow: 'visible',
		'--paraflow-container-inset': containerInset,
		paddingInlineStart: 'var(--paraflow-container-inset)', paddingInlineEnd: 'calc(var(--paraflow-container-callouts) * var(--paraflow-callout-padding, 12px))',
		paddingBlockEnd: 'calc(var(--paraflow-callout-ends) * var(--paraflow-callout-padding, 12px))' },
	'.cm-content > .paraflow-container-block > :is(.paraflow-rendered-block-preview, .paraflow-math-block-preview)': { marginBlock: '0 !important' },
};
