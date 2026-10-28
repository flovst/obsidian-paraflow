import { createDetachedEl, createDetachedSvg } from '../../dom';
import { EditorSelection, EditorState, Prec, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, Direction, EditorView, layer, RectangleMarker, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { createSharedMathParser } from '../math/shared-parser.js';
import { createNativeDecorationOwnership, isNativeReplacement, nativeBlockOwnership } from '../runtime/native-decoration-ownership.js';
import { detailsContainers, type DetailsContainer } from './details-source.js';
import { detailsParsingActive } from './details-state.js';
import { containerBlockFrame, containerInset, wrapContainerBlock, type ContainerFrame } from '../callout/container-surface.js';
import { listBlockInset } from '../paragraph/list-block-geometry.js';
import { normalizeParagraphSelectionEndpoint } from '../paragraph/selection-protection.js';
import type { DetailsOpenState } from '../../display/details-open-state.js';

const toggle = StateEffect.define<{ from: number; open: boolean }>();
const edit = StateEffect.define<number | null>();
const hover = StateEffect.define<number | null>();
const sharedOpen = StateEffect.define<ReadonlyMap<number, boolean>>();

export interface DetailsEditingState {
	cache: DetailsOpenState;
	sourcePath: (state: EditorState) => string;
}

function icon(document: Document, pathData: string, size: number): SVGSVGElement {
	const svg = createDetachedSvg(document, 'svg');
	svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
	svg.setAttribute('aria-hidden', 'true');
	const path = svg.appendChild(createDetachedSvg(document, 'path'));
	path.setAttribute('d', pathData); return svg;
}
class Summary extends WidgetType {
	constructor(readonly block: DetailsContainer, readonly title: string, readonly open: boolean, readonly frame: ContainerFrame | null) { super(); }
	eq(other: Summary): boolean {
		return this.block.from === other.block.from && this.block.to === other.block.to && this.block.bodyFrom === other.block.bodyFrom
			&& this.block.titleFrom === other.block.titleFrom && this.title === other.title && this.open === other.open && this.frame?.key === other.frame?.key;
	}
	toDOM(view: EditorView): HTMLElement {
		const root = createDetachedEl(view.dom.ownerDocument, 'div'); root.className = 'paraflow-details-summary';
		root.dataset.paraflowDetailsFrom = String(this.block.from);
		root.contentEditable = 'false';
		const editSummary = () => { view.dispatch({ effects: edit.of(this.block.from), selection: { anchor: this.block.titleFrom } }); view.focus(); };
		const button = root.appendChild(createDetachedEl(view.dom.ownerDocument, 'button'));
		button.type = 'button'; button.className = 'paraflow-details-toggle'; button.setAttribute('aria-expanded', String(this.open));
		const disclosure = icon(root.ownerDocument, this.open ? 'M3 5 L13 5 L8 12 Z' : 'M5 3 L12 8 L5 13 Z', 18);
		disclosure.setAttribute('fill', 'currentColor'); button.append(disclosure, this.title || '详细信息');
		button.addEventListener('click', event => {
			if (event.ctrlKey || event.metaKey) { editSummary(); return; }
			const selection = view.state.selection.main;
			view.dispatch({ effects: toggle.of({ from: this.block.from, open: !this.open }),
				...(this.open && this.block.bodyFrom <= selection.head && selection.head < this.block.to ? { selection: { anchor: this.block.from } } : {}) });
		});
		const source = root.appendChild(createDetachedEl(view.dom.ownerDocument, 'button'));
		source.type = 'button'; source.className = 'paraflow-details-source'; source.setAttribute('aria-label', '编辑折叠区域源码');
		const sourceIcon = icon(root.ownerDocument, 'M5 4.5 1.5 8 5 11.5 M11 4.5 14.5 8 11 11.5 M9.5 3 6.5 13', 16);
		sourceIcon.setAttribute('fill', 'none'); sourceIcon.setAttribute('stroke', 'currentColor'); sourceIcon.setAttribute('stroke-width', '.8');
		sourceIcon.setAttribute('stroke-linecap', 'round'); sourceIcon.setAttribute('stroke-linejoin', 'round');
		source.append('HTML ', sourceIcon); source.addEventListener('click', editSummary);
		return wrapContainerBlock(view, root, this.frame);
	}
	ignoreEvent(): boolean { return true; }
}
interface Projection { opened: ReadonlyMap<number, boolean>; expanded: ReadonlySet<number>; editing: number | null; active: boolean; hovered: number | null; decorations: DecorationSet }

class Background extends RectangleMarker {
	constructor(left: number, top: number, width: number, height: number, readonly frame: ContainerFrame | null) {
		super('paraflow-details-hover-rectangle', left, top, width, height);
	}
	eq(other: Background): boolean { return super.eq(other) && this.frame?.key === other.frame?.key; }
	draw(): HTMLDivElement {
		const element = super.draw();
		const fill = element.appendChild(createDetachedEl(element.ownerDocument, 'div')); fill.className = 'paraflow-details-hover-background';
		this.inset(element); return element;
	}
	update(element: HTMLElement, previous: Background): boolean { super.update(element, previous); this.inset(element); return true; }
	private inset(element: HTMLElement): void {
		const cards = this.frame?.rails.cards ?? [], last = cards.at(-1);
		element.style.setProperty('--paraflow-callout-depth', String(last ? last.depth - 1 : -1));
		element.style.setProperty('--paraflow-container-callouts', String(cards.filter(card => card.kind === 'callout').length));
		element.style.setProperty('--paraflow-callout-list-inset', last ? listBlockInset(last.listDepth ?? 0, last.listTask, last.listOrderedTask) : '0px');
	}
}

/** The last separator inside a container belongs to its closing syntax. */
function closingStart(state: EditorState, block: DetailsContainer): number {
	const closingLine = state.doc.lineAt(block.closingFrom).number;
	let blanks = 0;
	for (let number = closingLine - 1; number > 0; number--) {
		const line = state.doc.line(number);
		if (line.from < block.bodyFrom || !/^(?:[ \t]*>[ \t]?)*[ \t]*$/u.test(line.text)) break;
		blanks++;
	}
	return blanks ? state.doc.line(closingLine - (blanks % 2 === 0 ? 2 : 1)).from : block.closingFrom;
}

export function createDetailsEditing(isActive: (state: EditorState) => boolean, isHoverEnabled: () => boolean = () => true,
	shared?: DetailsEditingState): Extension {
	function project(state: EditorState, opened: ReadonlyMap<number, boolean>, editing: number | null, hovered: number | null, previousExpanded: ReadonlySet<number>): Projection {
		const ranges: Range<Decoration>[] = [];
		const expanded = new Set<number>();
		if (!isActive(state)) return { opened, expanded, editing: null, hovered: null, active: false, decorations: Decoration.none };
		const blocks = detailsContainers(state.sliceDoc());
		let hiddenTo = -1;
		for (const block of blocks) {
			if (block.from < hiddenTo) continue;
			if (block.from === editing) { hiddenTo = block.to; continue; }
			const selectedBody = state.selection.ranges.some(range => range.to >= block.bodyFrom && range.from < block.bodyTo &&
				(range.empty || previousExpanded.has(block.from)));
			const open = (opened.get(block.from) ?? block.open) || selectedBody;
			if (open) expanded.add(block.from);
			const widget = new Summary(block, state.sliceDoc(block.titleFrom, block.titleTo), open,
				containerBlockFrame(state, block.from, block.headerTo));
			ranges.push(Decoration.replace({ block: true, widget, inclusive: true }).range(block.from, open ? block.headerTo : block.to));
			if (open) {
				for (let line = state.doc.lineAt(block.bodyFrom).number; line < state.doc.lineAt(closingStart(state, block)).number; line++) {
					ranges.push(Decoration.line({ attributes: { class: 'paraflow-details-body-line',
						'data-paraflow-details-from': String(block.from) } }).range(state.doc.line(line).from));
				}
				ranges.push(Decoration.replace({ block: true, inclusive: true }).range(closingStart(state, block), block.to));
			} else hiddenTo = block.to;
		}
		return { opened, expanded, editing, hovered, active: true, decorations: Decoration.set(ranges, true) };
	}
	const field = StateField.define<Projection>({
		create: state => project(state, shared?.cache.opened(shared.sourcePath(state), state.sliceDoc()) ?? new Map(), null, null, new Set()),
		update(value, transaction) {
			if (!transaction.docChanged && !transaction.selection && transaction.effects.length === 1 && transaction.effects[0]!.is(hover)) {
				return { ...value, hovered: transaction.effects[0].value };
			}
			let opened = value.opened, expanded = value.expanded, editing = value.editing, hovered = value.hovered;
			if (shared && shared.sourcePath(transaction.startState) !== shared.sourcePath(transaction.state)) {
				return project(transaction.state, shared.cache.opened(shared.sourcePath(transaction.state), transaction.state.sliceDoc()), null, null, new Set());
			}
			if (transaction.docChanged) {
				opened = new Map([...opened].map(([from, open]) => [transaction.changes.mapPos(from), open]));
				expanded = new Set([...expanded].map(from => transaction.changes.mapPos(from)));
				if (editing !== null) editing = transaction.changes.mapPos(editing);
			}
			for (const effect of transaction.effects) {
				if (effect.is(toggle)) {
					opened = new Map([...opened, [effect.value.from, effect.value.open]]);
					expanded = new Set([...expanded].filter(from => from !== effect.value.from));
				}
				if (effect.is(edit)) editing = effect.value;
				if (effect.is(hover)) hovered = effect.value;
				if (effect.is(sharedOpen)) opened = effect.value;
			}
			if (editing !== null) {
				const block = detailsContainers(transaction.state.sliceDoc()).find(block => block.from === editing);
				if (!block || transaction.state.selection.main.head < block.from || transaction.state.selection.main.head > block.to) editing = null;
			}
			return project(transaction.state, opened, editing, hovered, expanded);
		},
		provide: field => [EditorView.decorations.from(field, value => value.decorations),
			EditorView.atomicRanges.of(view => view.state.field(field).decorations)],
	});
	const synchronization = shared ? ViewPlugin.define(view => {
		let path = shared.sourcePath(view.state), stopped = false, pending = false, active = isActive(view.state);
		const schedule = () => {
			if (pending) return;
			pending = true;
			queueMicrotask(() => {
				pending = false;
				if (stopped || shared.cache.source(path) !== view.state.sliceDoc()) return;
				const opened = shared.cache.opened(path, view.state.sliceDoc()), previous = view.state.field(field);
				const close = isActive(view.state) && previous.editing === null ? detailsContainers(view.state.sliceDoc()).find(block =>
					opened.get(block.from) === false
					&& block.bodyFrom <= view.state.selection.main.head && view.state.selection.main.head < block.to) : undefined;
				if (opened === previous.opened && !close) return;
				view.dispatch({ effects: sharedOpen.of(opened), ...(close ? { selection: { anchor: close.from } } : {}) });
			});
		};
		shared.cache.initialize(path, view.state.sliceDoc());
		let release = shared.cache.subscribe(path, schedule); schedule();
		return {
			update(update) {
				const nextActive = isActive(update.state);
				// Host mode changes and later selection restoration can reuse the same editor.
				if (nextActive && (!active || update.selectionSet)) schedule();
				active = nextActive;
				const nextPath = shared.sourcePath(update.state);
				if (nextPath !== path) {
					release(); path = nextPath;
					shared.cache.initialize(path, update.state.sliceDoc()); release = shared.cache.subscribe(path, schedule); schedule();
				} else {
					for (const transaction of update.transactions) {
						if (transaction.docChanged) shared.cache.update(path, transaction.startState.sliceDoc(), transaction.state.sliceDoc(), transaction.changes);
					}
				}
				for (const transaction of update.transactions) for (const effect of transaction.effects) {
					if (effect.is(toggle)) shared.cache.set(path, transaction.state.sliceDoc(), effect.value.from, effect.value.open);
				}
			},
			destroy() { stopped = true; release(); },
		};
	}) : [];
	const pointer = ViewPlugin.define(view => {
		const paintControls = () => {
			const block = detailsContainers(view.state.sliceDoc()).find(block => block.from === view.state.field(field).hovered);
			for (const summary of view.contentDOM.querySelectorAll<HTMLElement>('.paraflow-details-summary')) {
				const from = Number(summary.dataset.paraflowDetailsFrom);
				summary.classList.toggle('paraflow-details-source-visible', !!block && block.from <= from && from < block.to);
			}
		};
		const setHovered = (target: EventTarget | null) => {
			let from: number | null = null;
			if (isActive(view.state) && target instanceof view.dom.ownerDocument.defaultView!.Element) {
				const tagged = target.closest<HTMLElement>('[data-paraflow-details-from]');
				const position = tagged ? Number(tagged.dataset.paraflowDetailsFrom) : view.posAtDOM(target);
				from = detailsContainers(view.state.sliceDoc()).find(block => block.from <= position && position < block.to)?.from ?? null;
			}
			if (view.state.field(field).hovered !== from) view.dispatch({ effects: hover.of(from) });
			paintControls();
		};
		// Rendered widgets own their input events; disclosure hover spans them too.
		const enter = (event: Event) => setHovered(event.target), leave = () => setHovered(null);
		view.contentDOM.addEventListener('pointerover', enter); view.contentDOM.addEventListener('pointerleave', leave);
		return {
			update() { paintControls(); },
			destroy() { view.contentDOM.removeEventListener('pointerover', enter); view.contentDOM.removeEventListener('pointerleave', leave); },
		};
	});
	const measured = new WeakMap<EditorView, readonly Background[]>();
	const background = layer({
		above: true, class: 'paraflow-details-hover-layer',
		update(update, element) {
			element.style.opacity = isHoverEnabled() && isActive(update.state) && update.state.field(field).hovered !== null ? '1' : '0';
			return true;
		},
		markers(view) {
			const block = detailsContainers(view.state.sliceDoc()).find(block => block.from === view.state.field(field).hovered);
			if (!block) return measured.get(view) ?? [];
			if (view.state.field(field).editing === block.from) return [];
			const content = view.contentDOM.getBoundingClientRect();
			const first = view.lineBlockAt(block.from), last = view.lineBlockAt(block.to);
			const scroll = view.scrollDOM.getBoundingClientRect();
			const left = (view.textDirection === Direction.LTR ? scroll.left : scroll.right - view.scrollDOM.clientWidth * view.scaleX) - view.scrollDOM.scrollLeft * view.scaleX;
			const top = scroll.top - view.scrollDOM.scrollTop * view.scaleY;
			const markers = [new Background(content.left - left, view.documentTop + first.top - top, content.width, last.bottom - first.top,
				containerBlockFrame(view.state, block.from, block.headerTo))];
			measured.set(view, markers); return markers;
		},
	});
	const pointerSelection = EditorState.transactionFilter.of(transaction => {
		if (!transaction.isUserEvent('select.pointer') || transaction.docChanged || !isActive(transaction.state)) return transaction;
		const projection = transaction.state.field(field);
		const blocks = detailsContainers(transaction.state.sliceDoc());
		const map = (position: number) => {
			let result = position;
			const editing = blocks.find(block => block.from === projection.editing);
			for (const block of [...blocks].reverse()) {
				if (editing && editing.from <= block.from && block.to <= editing.to) continue;
				const open = projection.expanded.has(block.from);
				const closing = closingStart(transaction.state, block);
				if ((!open && block.headerTo <= result || open && closing <= result) && result <= block.to) {
					result = block.to < transaction.state.doc.length
						? normalizeParagraphSelectionEndpoint(transaction.state, block.to + 1, 1)
						: block.from;
				}
			}
			return result;
		};
		const selection = transaction.newSelection;
		const ranges = selection.ranges.map(range => EditorSelection.range(map(range.anchor), map(range.head)));
		if (ranges.every((range, index) => range.eq(selection.ranges[index]!))) return transaction;
		return [transaction, { selection: EditorSelection.create(ranges, selection.mainIndex), sequential: true }];
	});
	return [detailsParsingActive.of(true), createSharedMathParser(), Prec.highest(field), synchronization, pointer, background, pointerSelection,
		nativeBlockOwnership.of(state => {
			if (!isActive(state)) return null;
			const blocks = detailsContainers(state.sliceDoc());
			return (from, to, decoration) => isNativeReplacement(decoration) && blocks.some(block =>
				from <= block.headerTo && from >= block.from && to > block.headerTo && to <= block.to);
		}), createNativeDecorationOwnership(), EditorView.baseTheme({
			'.paraflow-details-summary': { display: 'flex', position: 'relative', alignItems: 'center', lineHeight: 'inherit', minHeight: '1.5em' },
			'.markdown-source-view.mod-cm6 & .cm-content .paraflow-details-summary': { display: 'flex' },
			'.paraflow-details-hover-layer': { opacity: '0', transition: 'opacity 160ms ease', pointerEvents: 'none' },
			'.paraflow-details-hover-rectangle': { boxSizing: 'border-box', paddingInlineStart: containerInset,
				paddingInlineEnd: 'calc(var(--paraflow-container-callouts) * var(--paraflow-callout-padding, 12px))' },
			'.paraflow-details-hover-background': { backgroundColor: 'rgba(0,0,0,.035)', height: '100%' },
			'.paraflow-details-summary button': { color: 'inherit', font: 'inherit', background: 'transparent', boxShadow: 'none', border: 'none', padding: '0', cursor: 'pointer' },
			'.paraflow-details-toggle': { display: 'inline-flex', alignItems: 'center', gap: '.25em' },
			'.paraflow-details-summary .paraflow-details-source': { display: 'inline-flex', alignItems: 'center', gap: '.25em', marginInlineStart: 'auto', fontSize: '.75em', color: 'var(--text-muted)', opacity: '0', transition: 'opacity 160ms ease' },
			'.paraflow-details-summary.paraflow-details-source-visible .paraflow-details-source,.paraflow-details-summary:focus-within .paraflow-details-source': { opacity: '1' },
		})];
}
