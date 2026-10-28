import { createDetachedEl, createDetachedSvg } from '../../dom';
import { codeFolding, foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';
import { EditorSelection, EditorState, Prec, RangeSet, StateEffect, StateField, type Extension, type Range as CMRange } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { calloutCards, quoteContainers, decodeCalloutBlock, calloutTitleBlock, calloutTitleFrom as titleFrom, type CalloutCard } from './presentation-model.js';
import { quotePrefix } from './projection.js';
import { mathQuotePrefix } from '../math/quote-prefix.js';
import { calloutGaps, createCalloutGapProtection } from './gaps.js';
import { containerLayout } from './container-layout.js';
import { ContainerRails as Rails, containerInset, containerPresentation, containerRailTails, containerSurfaceStyles } from './container-surface.js';
import { createCalloutNativeOwnership } from './native-ownership.js';
import { calloutHeadingBodyLines } from './heading-body.js';
import { containerHeadingBodyLines } from '../paragraph/heading-projection.js';
import { containerThematicBreaks } from '../paragraph/thematic-break-projection.js';
import { semanticBlockGapHeight } from '../paragraph/rhythm-css.js';
import { listBlockInset } from '../paragraph/list-block-geometry.js';
import { calloutThematicBreaks } from './thematic-breaks.js';
import { containerListProjections, getStructuredListProjectionState } from '../structured-list/projection.js';
import { calloutListDecorations, calloutListEntries } from './list-presentation.js';
import { containerPrefixClickTargets } from '../structured-list/mouse.js';
import { createRenderedSourceClickExtension, handoffRenderedSourceGesture, renderedSourceClickPosition } from '../runtime/rendered-source-click.js';
import {activateQuoteDraft,createQuoteDraftState} from './quote-draft.js';
import {createEmptyBodies,registerEmptyBody} from '../runtime/empty-body-state.js';
import { containerBodyLineProviders } from '../runtime/container-body-boundaries.js';
import { calloutBodyLine } from './body-boundaries.js';
import { emptyVisualLineAnchor } from '../runtime/navigation-core.js';

export interface CalloutPresentationOptions {
	readonly isActive: (view: EditorView) => boolean;
	readonly isActiveState?: (state: EditorState) => boolean;
	readonly isViewSupported?: (view: EditorView) => boolean;
	readonly getStyle?: () => 'default' | 'obsidian';
	readonly renderHeader: (source: string, element: HTMLElement, view: EditorView) => (() => void) & { refresh?: () => void };
}
const editMetadata = StateEffect.define<number | null>();
export function editCalloutMetadata(view: EditorView, card: CalloutCard): void {
	view.dispatch({ effects: editMetadata.of(card.from), selection: { anchor: card.from + quotePrefix(view.state.doc.lineAt(card.from).text, card.depth)!.length } });
	view.focus();
}
const initializeFolds = StateEffect.define<readonly number[]>();
const initializedFolds = StateField.define<ReadonlySet<number>>({
	create: () => new Set(),
	update(value, transaction) {
		const effects = transaction.effects.filter(effect => effect.is(initializeFolds));
		if (!transaction.docChanged && !effects.length) return value;
		const starts = new Set(calloutCards(transaction.state).map(card => card.from));
		const next = new Set([...value].map(from => transaction.changes.mapPos(from, 1)).filter(from => starts.has(from)));
		for (const effect of effects) if (effect.is(initializeFolds)) for (const from of effect.value) next.add(from);
		return next;
	},
});
const metadataField = StateField.define<number | null>({
	create: () => null,
	update(value, transaction) {
		for (const effect of transaction.effects) if (effect.is(editMetadata)) return effect.value;
		if (value === null) return null;
		const position = transaction.changes.mapPos(value);
		return transaction.state.doc.lineAt(transaction.state.selection.main.head).from === position ? position : null;
	},
});

export function isCalloutMetadataEditing(state: EditorState, from: number): boolean {
	return state.field(metadataField, false) === from;
}

function headerBoundary(state: EditorState, card: CalloutCard): number {
	return card.from + quotePrefix(state.doc.lineAt(card.from).text, card.depth)!.lastIndexOf('>');
}

export function calloutHeaderStart(state: EditorState, titleStartOnly = false): number | null {
	const selection = state.selection.main;
	if (state.selection.ranges.length !== 1 || !selection.empty) return null;
	const card = calloutCards(state).find(candidate => !isCalloutMetadataEditing(state, candidate.from) &&
		(titleStartOnly ? selection.head === titleFrom(candidate) : selection.head === headerBoundary(state,candidate) ||
			titleFrom(candidate) <= selection.head && selection.head <= candidate.headerTo));
	return card ? headerBoundary(state, card) : null;
}

export function calloutTitleEnd(state: EditorState, position: number): number | null {
	if (state.field(metadataField, false) === undefined) return null;
	return calloutCards(state).find(card => !isCalloutMetadataEditing(state, card.from) &&
		titleFrom(card) <= position && position <= card.headerTo)?.headerTo ?? null;
}

export function collapsedCalloutRange(state: EditorState, position: number): { from: number; to: number } | null {
	if (state.field(metadataField, false) === undefined) return null;
	let range: { from: number; to: number } | null = null;
	foldedRanges(state).between(position, position, (from, to) => {
		if (calloutCards(state).some(card => card.headerTo === from && !isCalloutMetadataEditing(state, card.from)) &&
			(range === null || from < range.from)) range = { from, to };
	});
	return range;
}

class HeaderIcon {
	node: HTMLElement | undefined;
	private dispose: ((() => void) & { refresh?: () => void }) | undefined;
	constructor(readonly type: string, readonly metadata: string, readonly options: CalloutPresentationOptions) {}
	attach(view: EditorView): HTMLElement {
		if (!this.node) {
			this.node = createDetachedEl(view.dom.ownerDocument, 'span');
			this.node.className = 'paraflow-callout-icon';
			this.node.setAttribute('aria-hidden', 'true');
		}
		if (!this.dispose) this.dispose = this.options.renderHeader(`> [!${this.type}${this.metadata ? `|${this.metadata}` : ''}]`, this.node, view);
		return this.node;
	}
	release(): void { this.dispose?.(); this.dispose = undefined; }
}

class Header extends WidgetType {
	constructor(readonly card: CalloutCard, readonly icon: HeaderIcon, readonly titleFocused: boolean) { super(); }
	eq(other: Header): boolean { return this.titleFocused === other.titleFocused && this.card.type === other.card.type && this.card.metadata === other.card.metadata && this.card.from === other.card.from && (titleFrom(this.card) === this.card.headerTo) === (titleFrom(other.card) === other.card.headerTo); }
	toDOM(view: EditorView): HTMLElement {
		const container = createDetachedEl(view.dom.ownerDocument, 'span');
		container.className = 'paraflow-callout-title';
		container.append(this.icon.attach(view));
		if (titleFrom(this.card) === this.card.headerTo && !this.titleFocused) {
			const placeholder = createDetachedEl(view.dom.ownerDocument, 'span');
			placeholder.className = 'paraflow-callout-default-title';
			placeholder.textContent = this.card.type.charAt(0).toUpperCase() + this.card.type.slice(1);
			placeholder.addEventListener('mousedown', event => {
				event.preventDefault(); event.stopPropagation();
				view.dispatch({ selection: { anchor: view.state.doc.lineAt(this.card.from).to } }); view.focus();
			});
			container.append(placeholder);
		}
		const edit = createDetachedEl(view.dom.ownerDocument, 'button');
		edit.type = 'button'; edit.className = 'paraflow-callout-edit';
		edit.setAttribute('aria-label', '编辑标注类型和折叠元数据');
		const sourceIcon = createDetachedSvg(view.dom.ownerDocument, 'svg');
		sourceIcon.setAttribute('viewBox', '0 0 16 16'); sourceIcon.setAttribute('aria-hidden', 'true');
		sourceIcon.setAttribute('focusable', 'false');
		const sourcePath = createDetachedSvg(view.dom.ownerDocument, 'path');
		sourcePath.setAttribute('d', 'M5 4.5 1.5 8 5 11.5 M11 4.5 14.5 8 11 11.5 M9.5 3 6.5 13');
		sourcePath.setAttribute('fill', 'none'); sourcePath.setAttribute('stroke', 'currentColor');
		sourcePath.setAttribute('stroke-width', '0.8'); sourcePath.setAttribute('stroke-linecap', 'round');
		sourcePath.setAttribute('stroke-linejoin', 'round');
		sourceIcon.append(sourcePath); edit.append(sourceIcon);
		edit.addEventListener('click', event => {
			event.preventDefault(); event.stopPropagation();
			view.dispatch({ effects: editMetadata.of(this.card.from), selection: { anchor: this.card.from + quotePrefix(view.state.doc.lineAt(this.card.from).text, this.card.depth)!.length } });
			view.focus();
		});
		container.append(edit);
		return container;
	}
	destroy(dom: HTMLElement): void { if (this.icon.node && dom.contains(this.icon.node)) this.icon.release(); }
	ignoreEvent(): boolean { return true; }
}

class FoldControl extends WidgetType {
	constructor(readonly from: number, readonly collapsed: boolean) { super(); }
	eq(other: FoldControl): boolean { return this.from === other.from && this.collapsed === other.collapsed; }
	toDOM(view: EditorView): HTMLElement {
		const fold = createDetachedEl(view.dom.ownerDocument, 'button');
		fold.type = 'button'; fold.className = 'callout-fold paraflow-callout-fold';
		fold.setAttribute('contenteditable', 'false');
		fold.setAttribute('aria-label', this.collapsed ? '展开 Callout' : '折叠 Callout');
		fold.setAttribute('aria-expanded', String(!this.collapsed));
		fold.dataset.collapsed = String(this.collapsed);
		const svg = createDetachedSvg(view.dom.ownerDocument, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
		const path = createDetachedSvg(view.dom.ownerDocument, 'path');
		path.setAttribute('d', this.collapsed ? 'm9 6 6 6-6 6' : 'm6 9 6 6 6-6');
		path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor');
		path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
		svg.append(path); fold.append(svg);
		const toggle = (event: Event): void => {
			event.preventDefault(); event.stopPropagation();
			const card = calloutCards(view.state).find(card => card.from === this.from)!;
			let collapsed = false;
			foldedRanges(view.state).between(card.headerTo, card.to, from => { if (from === card.headerTo) collapsed = true; });
			view.dispatch({ effects: (collapsed ? unfoldEffect : foldEffect).of({ from: card.headerTo, to: card.to }),
				selection: { anchor: card.headerTo } });
		};
		fold.addEventListener('mousedown', event => { if (event.button === 0) toggle(event); });
		fold.addEventListener('click', event => { if (event.detail === 0) toggle(event); });
		return fold;
	}
	ignoreEvent(): boolean { return true; }
}

function createTitleEditing(options: CalloutPresentationOptions): Extension {
	const views = new Set<EditorView>();
	function titleAt(view: EditorView, position: number): CalloutCard | undefined {
		if (!options.isActive(view) || view.composing) return undefined;
		return calloutCards(view.state).find(card => view.state.field(metadataField) !== card.from &&
			titleFrom(card) <= position && position <= card.headerTo);
	}
	function enter(view: EditorView): boolean {
		const selection = view.state.selection.main;
		const card = titleAt(view, selection.from);
		if (view.state.selection.ranges.length !== 1 || !card || selection.to > card.headerTo) return false;
		const insert = `\n${quotePrefix(view.state.doc.lineAt(card.from).text, card.depth)!}`;
		view.dispatch({ changes: { from: selection.from, to: selection.to, insert },
			selection: { anchor: selection.from + insert.length }, effects:registerEmptyBody.of(selection.from + insert.length), userEvent: 'input' });
		return true;
	}
	function titleEnd(view: EditorView, extend: boolean): boolean {
		const selection = view.state.selection.main, card = titleAt(view, selection.head);
		if (!card || view.state.selection.ranges.length !== 1) return false;
		view.dispatch({ selection: extend ? EditorSelection.range(selection.anchor, card.headerTo) : EditorSelection.cursor(card.headerTo, -1),
			userEvent: 'select', scrollIntoView: true });
		return true;
	}
	return [ViewPlugin.fromClass(class {
		constructor(readonly view: EditorView) { views.add(view); }
		destroy(): void { views.delete(this.view); }
	}), EditorState.transactionFilter.of(transaction => {
		const selection = transaction.startState.selection;
		if (!transaction.docChanged && transaction.isUserEvent('move.character') && transaction.newSelection.ranges.length === 1 && transaction.newSelection.main.empty) {
			const view = [...views].find(candidate => candidate.state === transaction.startState);
			if (!view || !options.isActive(view) || view.composing) return transaction;
			const head = transaction.newSelection.main.head;
			const folded = collapsedCalloutRange(transaction.startState, head);
			const nextCard = head > selection.main.head && calloutCards(transaction.startState).find(card => !isCalloutMetadataEditing(transaction.startState, card.from) &&
				card.from <= head && head < titleFrom(card));
			const position = folded ? folded.from : nextCard ? titleFrom(nextCard) : head;
			if (position !== head) return [transaction, { selection: EditorSelection.cursor(position, folded ? -1 : 1) }];
			return transaction;
		}
		if (!transaction.docChanged || !transaction.isUserEvent('delete') || selection.ranges.length !== 1 || !selection.main.empty) return transaction;
		const view = [...views].find(candidate => candidate.state === transaction.startState);
		if (!view || !options.isActive(view) || view.composing) return transaction;
		const card = calloutCards(view.state).find(candidate => view.state.field(metadataField) !== candidate.from &&
			candidate.from <= selection.main.head && selection.main.head <= candidate.headerTo);
		if (!card) return transaction;
		const boundary = titleFrom(card);
		let crossesPrefix = false;
		transaction.changes.iterChangedRanges((from, to) => {
			if (from < boundary && to > card.from) crossesPrefix = true;
		});
		return crossesPrefix ? [] : transaction;
	}), Prec.highest(keymap.of([
		{ key: 'End', mac: 'Ctrl-e', run: view => titleEnd(view, false), shift: view => titleEnd(view, true) },
		{ key: 'End', run: view => titleEnd(view, false), shift: view => titleEnd(view, true) },
		{ key: 'Backspace', run: view => {
			const selection = view.state.selection.main;
			const card = titleAt(view, selection.head);
			return view.state.selection.ranges.length === 1 && selection.empty && card !== undefined && selection.head === titleFrom(card);
		} },
		{ key: 'Enter', run: enter }, { key: 'Shift-Enter', run: enter },
	])), EditorView.inputHandler.of((view, from, to, text) => {
		const card = titleAt(view, from);
		if (!card || from !== to || from !== card.headerTo || titleFrom(card) !== card.headerTo || /[ \t]$/u.test(card.header) || !text) return false;
		const prefix = quotePrefix(view.state.doc.lineAt(card.from).text, card.depth)!;
		const insert = ` ${text.replace(/\n/gu, `\n${prefix}`)}`;
		view.dispatch({ changes: { from, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.type' });
		return true;
	})];
}

class ContainerBoundaryGap extends Rails {
	constructor(cards: readonly CalloutCard[], tails: readonly number[], readonly before: string, readonly after: string) { super(cards, tails); }
	eq(other: ContainerBoundaryGap): boolean { return super.eq(other) && this.before === other.before && this.after === other.after; }
	toDOM(view: EditorView): HTMLElement {
		const gap = createDetachedEl(view.dom.ownerDocument, 'div');
		gap.className = 'paraflow-container-boundary-gap';
		gap.dataset.paraflowBefore = this.before;
		gap.dataset.paraflowAfter = this.after;
		gap.setAttribute('aria-hidden', 'true');
		gap.append(super.toDOM(view));
		return gap;
	}
	ignoreEvent(): boolean { return false; }
}

function containerBoundaryDecorations(state: EditorState): DecorationSet {
	const cards = quoteContainers(state);
	return Decoration.set([...containerLayout(state).boundaries].map(([from, boundary]) => {
		const parents = cards.filter(card => card.from < from && card.to >= from);
		return Decoration.widget({ block: true, side: -1, widget: new ContainerBoundaryGap(parents, parents.map(() => 0), boundary.before, boundary.after) }).range(from);
	}), true);
}

function projectedContainers(view: EditorView): readonly CalloutCard[] {
	const cards = quoteContainers(view.state);
	// Whole-block replacements must be direct facets; they, rather than selection, own native rendering.
	const nativeBlocks: { from: number; to: number }[] = [];
	for (const decorations of view.state.facet(EditorView.decorations)) {
		if (typeof decorations === 'function') continue;
		decorations.between(0, view.state.doc.length, (from, to, decoration) => {
			if ((decoration.spec as { readonly block?: boolean }).block && from < to) nativeBlocks.push({ from, to });
		});
	}
	return cards.filter(card => !nativeBlocks.some(block => block.from <= card.from && block.to >= card.to));
}

function project(view: EditorView, options: CalloutPresentationOptions, icons: Map<number, HeaderIcon>): DecorationSet {
	if (!options.isActive(view)) {
		for (const icon of icons.values()) icon.release();
		icons.clear();
		return Decoration.none;
	}
	const active = projectedContainers(view);
	const visible = new Set(active.filter(card => card.kind === 'callout').map(card => card.from));
	for (const [from, icon] of icons) if (!visible.has(from)) { icon.release(); icons.delete(from); }
	const editingHeader = (card: CalloutCard): boolean => view.state.field(metadataField) === card.from;
	const ranges: CMRange<Decoration>[] = [];
	const listEntries = calloutListEntries(view.state, active);
	const listLines = new Map(listEntries.flatMap(entry => [[entry.prefix.from, { entry, depth: entry.marker.depth + 1 }] as const,
		...entry.ownedLines.map(line => [line.range.from, { entry, depth: line.depth + 1 }] as const)]));
	calloutListDecorations(view.state, listEntries).between(0, view.state.doc.length, (from, to, decoration) => { ranges.push(decoration.range(from, to)); });
	const gaps = calloutGaps(view.state);
	const rows = new Map<number, CalloutCard[]>();
	const collapsedCards = new Set<number>();
	for (const card of active) {
		for (let number = view.state.doc.lineAt(card.from).number; number <= view.state.doc.lineAt(card.to).number; number += 1) {
			const ancestors = rows.get(number) ?? [];
			ancestors.push(card);
			rows.set(number, ancestors);
		}
		if (card.kind === 'quote') continue;
		let collapsed = false;
		foldedRanges(view.state).between(card.headerTo, card.to, from => { if (from === card.headerTo) collapsed = true; });
		if (collapsed) collapsedCards.add(card.from);
		if (!editingHeader(card)) {
			const from = titleFrom(card);
			let icon = icons.get(card.from);
			if (!icon || icon.type !== card.type || icon.metadata !== card.metadata) {
				icon?.release();
				icon = new HeaderIcon(card.type, card.metadata, options);
				icons.set(card.from, icon);
			}
			const selection = view.state.selection.main;
			const titleFocused = view.hasFocus && selection.head >= from && selection.head <= card.headerTo;
			ranges.push(Decoration.replace({ widget: new Header(card, icon, titleFocused), paraflowCalloutPrefix: true }).range(card.from, from));
			if (from < card.headerTo) ranges.push(Decoration.mark({ class: 'paraflow-callout-title-text' }).range(from, card.headerTo));
			if (card.fold) ranges.push(Decoration.widget({ widget: new FoldControl(card.from, collapsed), side: 1 }).range(card.headerTo));
		}
	}
	for (const [number, ancestors] of rows) {
		const card = ancestors[ancestors.length - 1]!;
		const line = view.state.doc.line(number);
		ranges.push(Decoration.widget({ widget: new Rails(ancestors,
			containerRailTails(ancestors, line.to), line), side: -1 }).range(line.from));
		const owner = listLines.get(line.from);
		const header = card.kind === 'callout' && line.from === card.from;
		const prefix = mathQuotePrefix(view.state, line.from, card.depth);
		const blank = !header && prefix !== null && !line.text.slice(prefix.length).trim();
		const ownedGap = blank ? gaps.find(candidate => candidate.from <= line.from && (line.to < candidate.to || candidate.edge === 'trailing' && line.to === candidate.to)) : undefined;
		const gap = ownedGap !== undefined;
		const gapTail = ownedGap && (ownedGap.edge !== undefined || ownedGap.from === card.headerTo || view.state.doc.lineAt(ownedGap.from).number + 1 < number);
		ranges.push(Decoration.line({ class: `${card.kind === 'callout' ? 'callout' : 'paraflow-quote-line'} paraflow-callout-line${owner && !blank ? ' paraflow-callout-list-row' : ''}${header ? ' paraflow-callout-first' : ''}${header && collapsedCards.has(card.from) ? ' paraflow-callout-collapsed' : ''}${header && !editingHeader(card) ? ' paraflow-callout-header-projected' : ''}${line.to === card.to ? ' paraflow-callout-last' : ''}${gap ? ' paraflow-callout-gap' : ''}${gapTail ? ' paraflow-callout-gap-tail' : ''}`,
			attributes: { 'data-callout': card.type, 'data-callout-metadata': card.metadata,
				...(ownedGap && !gapTail && ownedGap.before && ownedGap.after ? { 'data-paraflow-before': ownedGap.before, 'data-paraflow-after': ownedGap.after } : {}),
				style: `--paraflow-callout-depth:${card.depth - 1};--paraflow-callout-list-inset:${listBlockInset(card.listDepth ?? 0, card.listTask, card.listOrderedTask)};--paraflow-callout-list-depth:${owner?.depth ?? 0};--paraflow-container-callouts:${ancestors.filter(ancestor => ancestor.kind === 'callout').length};--paraflow-callout-ends:${ancestors.filter(ancestor => ancestor.kind === 'callout' && ancestor.to === line.to).length}` } }).range(line.from));
		if (header && !editingHeader(card)) continue;
		if (prefix) ranges.push(Decoration.replace({ paraflowCalloutPrefix: true }).range(line.from, line.from + prefix.length));
	}
	return Decoration.set(ranges, true);
}

function blockText(element: Element): string {
	const clone = element.cloneNode(true) as Element;
	clone.querySelectorAll('ul, ol, .callout, input, .list-bullet').forEach(child => child.remove());
	return (clone.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

/** Captured before Obsidian's whole-widget selection handler; source CM remains the only editable surface. */
export function createCalloutPresentation(options: CalloutPresentationOptions): Extension {
	const activateBoundaries = StateEffect.define<boolean>();
	const boundaries = StateField.define<{ active: boolean; decorations: DecorationSet }>({
		create: () => ({ active: false, decorations: Decoration.none }),
		update(value, transaction) {
			const active = options.isActiveState?.(transaction.state) !== false && (transaction.effects.find(effect => effect.is(activateBoundaries))?.value ?? value.active);
			return !transaction.docChanged && active === value.active ? value : { active, decorations: active ? containerBoundaryDecorations(transaction.state) : Decoration.none };
		},
		provide: field => EditorView.decorations.from(field, value => value.decorations),
	});
	const plugin = ViewPlugin.fromClass(class {
		private destroyed = false;
		private pending = false;
		private icons = new Map<number, HeaderIcon>();
		decorations: DecorationSet;
		constructor(readonly view: EditorView) {
			this.decorations = project(view, options, this.icons);
			view.dom.addEventListener('mousedown', this.pointer, true);
			this.syncBoundaries();
		}
		update(update: ViewUpdate): void {
			if (update.docChanged) this.icons = new Map([...this.icons].map(([from, icon]) => [update.changes.mapPos(from, 1), icon]));
			this.decorations = project(this.view, options, this.icons); this.syncBoundaries();
		}
		destroy(): void {
			this.destroyed = true; this.view.dom.removeEventListener('mousedown', this.pointer, true);
			for (const icon of this.icons.values()) icon.release();
			this.icons.clear();
		}
		syncBoundaries(): void {
			const active = options.isActive(this.view) && options.isActiveState?.(this.view.state) !== false;
			const uninitialized = (): readonly CalloutCard[] => projectedContainers(this.view).filter(card => card.kind === 'callout' && !this.view.state.field(initializedFolds).has(card.from));
			if (this.pending || (this.view.state.field(boundaries).active === active && (!active || !uninitialized().length))) return;
			this.pending = true;
			queueMicrotask(() => {
				this.pending = false;
				if (this.destroyed) return;
				const active = options.isActive(this.view) && options.isActiveState?.(this.view.state) !== false;
				const cards = active ? uninitialized() : [];
				this.view.dispatch({ effects: [activateBoundaries.of(active), activateQuoteDraft.of(active), initializeFolds.of(cards.map(card => card.from)),
					...cards.filter(card => card.fold === '-' && card.headerTo < card.to).map(card => foldEffect.of({ from: card.headerTo, to: card.to }))] });
			});
		}
		pointer = (event: MouseEvent): void => {
			const target = event.target as Element | null;
			if (!options.isActive(this.view) || this.view.composing || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.detail > 1 || target?.nodeType !== 1) return;
			const native = target.closest('.cm-embed-block.cm-callout');
			if (!native || !this.view.contentDOM.contains(native) || target.closest('input, .callout-fold, .internal-embed, .image-embed') || target.closest('.cm-editor') !== this.view.dom) return;
			const origin = this.view.posAtDOM(native);
			const allCards = calloutCards(this.view.state);
			const outer = allCards.find(card => card.from === origin);
			if (!outer) return;
			const rendered = target.closest('.callout');
			const renderedCards = Array.from(native.querySelectorAll('.callout'));
			const candidates = allCards.filter(card => card.from >= outer.from && card.to <= outer.to);
			const card = candidates[rendered ? renderedCards.indexOf(rendered) : 0];
			if (!card) return;
			this.view.dispatch({ effects: initializeFolds.of(candidates.map(candidate => candidate.from)) });
			const folds = renderedCards.length === candidates.length ? renderedCards.flatMap((element, index) => {
				if (!element.classList.contains('is-collapsible')) return [];
				const source = candidates[index]!;
				return [(element.classList.contains('is-collapsed') ? foldEffect : unfoldEffect).of({ from: source.headerTo, to: source.to })];
			}) : [];
			const metadata = target.closest('.edit-block-button');
			if (metadata) {
				event.preventDefault(); event.stopImmediatePropagation();
				this.view.dispatch({ effects: [...folds, editMetadata.of(card.from)], selection: { anchor: card.from + quotePrefix(this.view.state.doc.lineAt(card.from).text, card.depth)!.length } });
				this.view.focus(); return;
			}
			if (!rendered) return;
			const title = target.closest<HTMLElement>('.callout-title-inner');
			if (title) {
				const source = calloutTitleBlock(this.view.state, card);
				const doc = this.view.dom.ownerDocument;
				const text = source ? decodeCalloutBlock(source, entity => new doc.defaultView!.DOMParser().parseFromString(entity, 'text/html').body.textContent) : null;
				if (text && blockText(title) !== text.text) return;
				const position = text ? renderedSourceClickPosition(event, title, (node, offset) => {
					const before = doc.createRange(); before.selectNodeContents(title); before.setEnd(node, offset);
					return text.positions[before.toString().replace(/\s+/gu, ' ').replace(/^ /u, '').length] ?? null;
				}) : card.headerTo;
				if (position === null) return;
				handoffRenderedSourceGesture(this.view, event, position, () => options.isActive(this.view), folds);
				return;
			}
			if (target.closest('.callout-title')) return;
			const block = target.closest('p, li, h1, h2, h3, h4, h5, h6');
			if (!block) return;
			const elements = Array.from(rendered.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6')).filter(element =>
				element.closest('.callout') === rendered && !element.closest('.callout-title') &&
				!(element.tagName === 'LI' && Array.from(element.children).some(child => child.tagName === 'P')));
			const targetBlock = block;
			const index = elements.indexOf(targetBlock);
			const source = card.blocks[index];
			const tag = targetBlock.tagName === 'P' && targetBlock.parentElement?.tagName === 'LI' ? 'li' : targetBlock.tagName.toLowerCase();
			if (elements.length !== card.blocks.length || !source || source.tag !== tag) return;
			const doc = this.view.dom.ownerDocument;
			const renderedText = decodeCalloutBlock(source, entity => new doc.defaultView!.DOMParser().parseFromString(entity, 'text/html').body.textContent);
			if (blockText(targetBlock) !== renderedText.text) return;
			const position = renderedSourceClickPosition(event, targetBlock as HTMLElement, (node, offset) => {
				const before = doc.createRange(); before.selectNodeContents(targetBlock); before.setEnd(node, offset);
				return renderedText.positions[before.toString().replace(/\s+/gu, ' ').replace(/^ /u, '').length] ?? null;
			});
			if (position === null) return;
			handoffRenderedSourceGesture(this.view, event, position, () => options.isActive(this.view), folds);
		};
	}, { decorations: instance => instance.decorations,
		provide: extension => EditorView.atomicRanges.of(view => view.plugin(extension)?.decorations.update({
			filter: (_from, _to, decoration) => (decoration.spec as { paraflowCalloutPrefix?: boolean }).paraflowCalloutPrefix === true,
		}) ?? Decoration.none) });
	return [createEmptyBodies(),createQuoteDraftState(state=>options.isActiveState?.(state)!==false),containerPresentation.of(options), createCalloutNativeOwnership(options), codeFolding(), metadataField, initializedFolds, boundaries, createTitleEditing(options), createRenderedSourceClickExtension(),
		containerBodyLineProviders.of((state, position) => options.isActiveState?.(state) === false ? null : calloutBodyLine(state, position)),
		emptyVisualLineAnchor.of((state, position) => {
			if (options.isActiveState?.(state) === false) return null;
			const card = calloutCards(state).find(card => card.from <= position && position <= card.headerTo &&
				titleFrom(card) === card.headerTo && !isCalloutMetadataEditing(state, card.from));
			return card?.headerTo ?? null;
		}),
		containerHeadingBodyLines.of(state => options.isActiveState?.(state) === false ? [] : calloutHeadingBodyLines(state)),
		containerThematicBreaks.of(state => options.isActiveState?.(state) === false ? [] : calloutThematicBreaks(state)),
		containerListProjections.of(state => options.isActiveState?.(state) === false ? [] : calloutListEntries(state)),
		containerPrefixClickTargets.of((state, position) => options.isActiveState?.(state) === false ? null :
			calloutListEntries(state).find(entry => entry.prefix.from <= position && position <= entry.prefix.to)?.prefix.to ?? null),
		EditorView.atomicRanges.of(view => options.isActive(view)
			? getStructuredListProjectionState(view.state)!.atomicRanges : RangeSet.empty),
		plugin, createCalloutGapProtection(options.isActive),
		EditorView.editorAttributes.of(view => options.isActive(view) ? { class: 'paraflow-callout-active', 'data-paraflow-callout-style': options.getStyle?.() ?? 'default' } : null), EditorView.theme({
		'.cm-content > .callout.paraflow-callout-icon-probe': { position: 'absolute !important', visibility: 'hidden !important', pointerEvents: 'none !important', inset: '0' },
		'.cm-content > .cm-line.paraflow-callout-line:not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)': { margin: '0 !important',
			paddingInlineEnd: 'calc(var(--paraflow-container-callouts) * var(--paraflow-callout-padding, 12px)) !important',
			overflow: 'visible', position: 'relative' },
		'.cm-content > .cm-line.paraflow-callout-line:not(.paraflow-heading-line):not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)': {
			border: '0 !important', borderRadius: '0', backgroundColor: 'transparent !important' },
		'.cm-content > .cm-line.callout.paraflow-callout-line': { fontStyle: 'normal' },
		'.cm-content > .cm-line.paraflow-callout-line': { '--paraflow-container-inset': containerInset },
		'.cm-content > .cm-line.paraflow-callout-line.paraflow-heading-line': { '--paraflow-container-row-padding': 'var(--paraflow-heading-padding-bottom, 0px)' },
		'.cm-content > .cm-line.paraflow-callout-line.paraflow-rendered-source-line, .cm-content > .cm-line.paraflow-callout-line.paraflow-math-source-block': {
			'--paraflow-container-end-inset': 'calc(var(--paraflow-container-callouts) * var(--paraflow-callout-padding, 12px))',
			paddingInlineStart: 'calc(var(--paraflow-container-inset) + 4.5ch) !important',
			paddingInlineEnd: 'calc(var(--paraflow-container-end-inset) + .5em) !important',
			marginBlock: '0 !important', borderInline: '0 !important',
			borderRadius: '0 !important',
			background: 'linear-gradient(to right, transparent var(--paraflow-container-inset), var(--paraflow-surface-color, var(--background-secondary)) var(--paraflow-container-inset), var(--paraflow-surface-color, var(--background-secondary)) calc(100% - var(--paraflow-container-end-inset)), transparent calc(100% - var(--paraflow-container-end-inset))) !important' },
		'.cm-content > .cm-line.paraflow-callout-line.paraflow-rendered-source-line::before, .cm-content > .cm-line.paraflow-callout-line.paraflow-math-source-block::before': { insetInlineStart: 'var(--paraflow-container-inset) !important' },
		'.cm-content > .cm-line.paraflow-callout-line.paraflow-rendered-source-html.is-last': { paddingBlockEnd: 'calc(.3em + var(--paraflow-callout-ends) * var(--paraflow-callout-padding, 12px)) !important' },
		'.cm-content > .cm-line.paraflow-callout-line:not(.paraflow-callout-list-row):not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)': {
			paddingInlineStart: 'var(--paraflow-container-inset) !important', textIndent: '0 !important' },
		'.cm-content > .cm-line.paraflow-callout-line:not(.paraflow-heading-line):not(.paraflow-callout-list-row):not(.paraflow-callout-first):not(.paraflow-callout-last):not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)': { paddingBlock: '0 !important' },
		'.cm-content > .cm-line.paraflow-callout-line:not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)::before': { display: 'none !important' },
		...containerSurfaceStyles,
		'.cm-content > .paraflow-container-boundary-gap': { position: 'relative', fontSize: 'var(--font-text-size, 1rem)', height: 'var(--paraflow-callout-gap, .8em)', contain: 'none !important' },
		'.cm-content > .cm-line.paraflow-callout-list-row:not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)': { '--paraflow-container-row-padding': 'var(--paraflow-list-row-padding, .25em)' },
		'.cm-content > .cm-line.paraflow-callout-line.paraflow-callout-first:not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)': { paddingTop: 'var(--paraflow-callout-padding, 12px) !important', borderRadius: 'var(--callout-radius, 4px) var(--callout-radius, 4px) 0 0' },
		'.cm-content > .cm-line.paraflow-callout-first:not(.paraflow-callout-last):not(.paraflow-callout-collapsed)': { paddingBottom: 'var(--paraflow-callout-title-body-gap, 1em) !important' },
		'.cm-content > .cm-line.paraflow-callout-first.paraflow-callout-collapsed': { paddingBottom: 'var(--paraflow-callout-padding, 12px) !important' },
		'.cm-content > .cm-line.paraflow-callout-header-projected': { lineHeight: 'var(--paraflow-callout-title-leading, 1.3) !important' },
		'.cm-content > .cm-line.paraflow-callout-header-projected > .cm-widgetBuffer': { height: '0 !important', verticalAlign: 'baseline !important' },
		'.cm-content > .cm-line.paraflow-callout-header-projected > .cm-foldPlaceholder': { display: 'none' },
		'.cm-content > .cm-line.paraflow-callout-last:not(.paraflow-heading-line):not(.paraflow-callout-list-row):not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)': { paddingBottom: 'calc(var(--paraflow-callout-ends) * var(--paraflow-callout-padding, 12px)) !important', borderRadius: '0 0 var(--callout-radius, 4px) var(--callout-radius, 4px)' },
		'.cm-content > .cm-line.paraflow-callout-last:not(.paraflow-callout-first):not(.paraflow-callout-list-row):not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)': { paddingBottom: 'calc(var(--paraflow-container-row-padding, 0px) + var(--paraflow-callout-ends) * var(--paraflow-callout-padding, 12px)) !important' },
		'.cm-content > .cm-line.paraflow-callout-last.paraflow-callout-list-row:not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)': { paddingBottom: 'var(--paraflow-container-row-padding, 0px) !important', borderRadius: '0 0 var(--callout-radius, 4px) var(--callout-radius, 4px)' },
		'.cm-content > .cm-line.paraflow-callout-gap:not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)': { lineHeight: '0 !important', fontSize: 'var(--font-text-size, 1rem)', height: 'var(--paraflow-callout-gap, .8em) !important', minHeight: 'var(--paraflow-callout-gap, .8em) !important' },
		'.cm-content > :is(.paraflow-container-boundary-gap, .cm-line.paraflow-callout-gap):is([data-paraflow-before="code-block"], [data-paraflow-after="code-block"], [data-paraflow-before="table"], [data-paraflow-after="table"]):not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)': { height: `${semanticBlockGapHeight} !important`, minHeight: `${semanticBlockGapHeight} !important` },
		'.cm-content > .cm-line.paraflow-callout-gap:not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block) > .cm-widgetBuffer': { height: '0 !important' },
		'.cm-content > .cm-line.paraflow-callout-gap-tail:not(.paraflow-code-line):not(.paraflow-rendered-source-line):not(.paraflow-math-source-block)': { height: '0 !important', minHeight: '0 !important' },
		'.paraflow-callout-title': { display: 'inline-flex', verticalAlign: 'top', alignItems: 'center', gap: '.25em', paddingInlineEnd: 'var(--paraflow-callout-title-gap, .375em)', height: 'calc(var(--paraflow-callout-title-leading, 1.3) * 1em)', lineHeight: '1', userSelect: 'none' },
		'.paraflow-callout-title-text, .paraflow-callout-default-title': { fontWeight: 'var(--callout-title-weight, 600)', color: 'var(--callout-color)' },
		'.paraflow-callout-icon': { color: 'var(--callout-color)', display: 'inline-block', width: '1em', height: '1em', overflow: 'hidden' },
		'.paraflow-callout-icon .callout': { margin: '0 !important', padding: '0 !important', border: '0 !important', background: 'none !important' },
		'.paraflow-callout-icon .callout-title': { padding: '0', gap: '0', lineHeight: '1' },
		'.paraflow-callout-icon .callout-content, .paraflow-callout-icon .callout-title-inner, .paraflow-callout-icon .callout-fold': { display: 'none' },
		'.paraflow-callout-icon .callout-icon, .paraflow-callout-icon svg': { width: '1em', height: '1em', flex: 'none' },
		'.paraflow-callout-fold': { display: 'inline-flex', position: 'relative', verticalAlign: 'middle', marginInlineStart: '.25em', padding: '0', width: '1em', height: '1em', border: '0', background: 'none', boxShadow: 'none', color: 'var(--callout-color)' },
		'.paraflow-callout-fold[data-collapsed="true"]::after': { content: '"…"', position: 'absolute', insetInlineStart: 'calc(100% + .375em)', color: 'var(--text-muted)', pointerEvents: 'none', userSelect: 'none' },
		'.paraflow-callout-fold > svg': { width: '1em', height: '1em' },
		'.paraflow-callout-edit': { position: 'absolute', right: '0', top: '0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 'calc(var(--paraflow-callout-title-leading, 1.3) * 1em)', padding: '0 4px', fontSize: 'inherit', color: 'var(--paraflow-source-control-color, #333333)', border: '0', background: 'transparent', boxShadow: 'none', cursor: 'pointer' },
		'.paraflow-callout-edit > svg': { display: 'block', width: '1em', height: '1em', flex: 'none' },
	})];
}
