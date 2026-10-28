import { createDetachedEl } from '../../dom';
import { foldedRanges, syntaxTree, unfoldEffect } from '@codemirror/language';
import { EditorSelection, Prec, StateEffect, StateField, Transaction, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, hoverTooltip, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { buildFootnoteIndex, footnoteDefinitionContent, type FootnoteDefinition, type FootnoteIndex, type FootnoteRange, type FootnoteReference } from './index.js';
import { classifyCurrentSelectionMode, createInputStateExtension, requireCompositionState } from '../runtime/input-state.js';
import { createSelectionPresentationSessionExtension, selectionPointerPressed, selectionProjectionCoverage } from '../runtime/selection-session.js';
import { bindRenderedSourceClick, createRenderedSourceClickExtension, renderedSourcePointerPosition } from '../runtime/rendered-source-click.js';
import { createNativeDecorationOwnership, nativeInlineOwnership, isNativeReplacement } from '../runtime/native-decoration-ownership.js';

export interface FootnoteOptions {
	readonly isActive: (view: EditorView) => boolean;
	readonly notify: (message: string) => void;
	readonly hideDefinitionMarkers?: () => boolean;
}

interface NavigationTarget {
	readonly id: string;
	readonly status: FootnoteReference['status'];
	readonly destination: FootnoteRange | null;
}

function referenceTarget(index: FootnoteIndex, reference: FootnoteReference): NavigationTarget {
	return { id: reference.id, status: reference.status,
		destination: reference.status === 'resolved' ? index.definitions.find(def => def.id === reference.id)! : null,
	};
}

export const footnoteIndexField = StateField.define<FootnoteIndex>({
	create: state => buildFootnoteIndex(state.doc.toString()),
	update: (index, transaction) => transaction.docChanged || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
		? buildFootnoteIndex(transaction.state.doc.toString()) : index,
});

const highlightEffect = StateEffect.define<FootnoteRange | null>();
const highlightField = StateField.define<FootnoteRange | null>({
	create: () => null,
	update(value, transaction) {
		for (const effect of transaction.effects) if (effect.is(highlightEffect)) return effect.value;
		return value && transaction.docChanged
			? { from: transaction.changes.mapPos(value.from), to: transaction.changes.mapPos(value.to) } : value;
	},
});

export function isFootnoteNavigationEvent(event: MouseEvent | KeyboardEvent): boolean {
	return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
		'button' in event && event.button === 0;
}

function editing(active: FootnoteRange | null, range: FootnoteRange): boolean {
	return active?.from === range.from && active.to === range.to;
}

class LabelWidget extends WidgetType {
	private static readonly cleanups = new WeakMap<HTMLElement, () => void>();
	constructor(readonly note: FootnoteReference | FootnoteDefinition, readonly reference: boolean,
		readonly onKeydown: (event: KeyboardEvent) => void, readonly isOwnerActive: () => boolean, readonly showSyntax = false) { super(); }
	eq(other: LabelWidget): boolean {
		return this.note === other.note && this.reference === other.reference && this.onKeydown === other.onKeydown &&
			this.isOwnerActive === other.isOwnerActive && this.showSyntax === other.showSyntax;
	}
	toDOM(view: EditorView): HTMLElement {
		const element = createDetachedEl(view.dom.ownerDocument, 'span');
		element.className = this.reference ? 'paraflow-footnote-reference' : 'paraflow-footnote-definition';
		element.textContent = this.note.id;
		if (!this.reference) {
			const open = createDetachedEl(view.dom.ownerDocument, 'span');
			const close = createDetachedEl(view.dom.ownerDocument, 'span');
			open.className = close.className = this.showSyntax
				? 'paraflow-footnote-marker' : 'paraflow-footnote-marker paraflow-footnote-marker-hidden';
			if (!this.showSyntax) { open.setAttribute('aria-hidden', 'true'); close.setAttribute('aria-hidden', 'true'); }
			open.textContent = '[^'; close.textContent = ']:';
			element.prepend(open); element.append(close);
		}
		LabelWidget.cleanups.set(element, bindRenderedSourceClick(view, element, (node, offset) => {
			const range = element.ownerDocument.createRange();
			range.selectNodeContents(element);
			range.setEnd(node, offset);
			return this.note.from + (this.reference ? 2 : 0) + range.toString().length;
		}, this.isOwnerActive));
		element.dataset.footnoteNumber = String(this.note.number);
		element.dataset.footnoteStatus = this.note.status;
		const description = this.note.status === 'duplicate' ? `脚注定义重复：${this.note.id}`
			: this.note.status === 'missing' ? `找不到脚注定义：${this.note.id}`
			: this.reference ? '按住 Ctrl/Cmd + 单击 跳转到脚注定义' : `脚注定义：${this.note.id}`;
		if (!this.reference) element.title = description;
		if (this.reference) {
			element.dataset.footnoteFrom = String(this.note.from);
			element.dataset.footnoteId = this.note.id;
			element.setAttribute('role', 'link');
			element.tabIndex = 0;
			// Obsidian turns aria-label into another visual tooltip. The link already
			// has its visible ID as accessible name; description adds keyboard help.
			element.setAttribute('aria-description', `脚注 ${this.note.id}。${description}；聚焦后可按回车或空格`);
			element.addEventListener('keydown', this.onKeydown);
		}
		return element;
	}
	destroy(dom: HTMLElement): void {
		LabelWidget.cleanups.get(dom)!();
		LabelWidget.cleanups.delete(dom);
		dom.removeEventListener('keydown', this.onKeydown);
	}
	ignoreEvent(): boolean { return false; }
}

class BacklinksWidget extends WidgetType {
	constructor(readonly definition: FootnoteDefinition, readonly onKeydown: (event: KeyboardEvent) => void) { super(); }
	eq(other: BacklinksWidget): boolean { return this.definition === other.definition && this.onKeydown === other.onKeydown; }
	toDOM(view: EditorView): HTMLElement {
		const container = createDetachedEl(view.dom.ownerDocument, 'span');
		container.className = 'paraflow-footnote-backlinks';
		container.addEventListener('keydown', this.onKeydown);
		for (const reference of this.definition.references) {
			const button = createDetachedEl(container.ownerDocument, 'button');
			button.type = 'button';
			button.className = 'paraflow-footnote-backlink';
			button.textContent = `↩${reference.occurrence}`;
			button.dataset.footnoteFrom = String(this.definition.from);
			button.dataset.footnoteTarget = String(reference.from);
			button.dataset.footnoteTargetEnd = String(reference.to);
			button.dataset.footnoteStatus = this.definition.status;
			button.dataset.footnoteId = this.definition.id;
			button.setAttribute('aria-label', `按住 Ctrl/Cmd 单击返回第${reference.occurrence}次引用`);
			button.setAttribute('aria-description', `脚注 ${reference.id}；聚焦后按回车或空格`);
			container.append(button);
		}
		return container;
	}
	destroy(dom: HTMLElement): void { dom.removeEventListener('keydown', this.onKeydown); }
	ignoreEvent(): boolean { return false; }
}

function project(view: EditorView, options: FootnoteOptions,
	onKeydown: (event: KeyboardEvent) => void, activeSource: FootnoteRange | null, isOwnerActive: () => boolean): DecorationSet {
	if (!options.isActive(view)) return Decoration.none;
	const index = view.state.field(footnoteIndexField);
	const ranges: Range<Decoration>[] = [];
	const hiddenSource = Decoration.mark({ class: 'paraflow-footnote-source', attributes: { 'aria-hidden': 'true' } });
	for (const reference of index.references) {
		if (editing(activeSource, reference)) {
			ranges.push(Decoration.mark({ class: 'paraflow-footnote-reference-source' }).range(reference.from, reference.to));
			continue;
		}
		ranges.push(hiddenSource.range(reference.from, reference.to),
			Decoration.widget({ widget: new LabelWidget(reference, true, onKeydown, isOwnerActive), side: -1 }).range(reference.from));
	}
	for (const definition of index.definitions) {
		ranges.push(Decoration.line({ class: 'paraflow-footnote-row' }).range(view.state.doc.lineAt(definition.from).from));
		if (!editing(activeSource, definition)) {
			ranges.push(hiddenSource.range(definition.from, definition.to),
				Decoration.widget({ widget: new LabelWidget(definition, false, onKeydown, isOwnerActive,
					!(options.hideDefinitionMarkers?.() ?? true)), side: -1 }).range(definition.from));
		} else {
			const marker = Decoration.mark({ class: 'paraflow-footnote-marker' });
			ranges.push(Decoration.mark({ class: 'paraflow-footnote-definition-source' }).range(definition.from, definition.to),
				marker.range(definition.from, definition.from + 2), marker.range(definition.to - 2, definition.to));
		}
		if (definition.references.length) ranges.push(Decoration.widget({ widget: new BacklinksWidget(definition, onKeydown), side: 1 })
			.range(view.state.doc.lineAt(definition.from).to));
	}
	// Native footnote rows include continuation paragraphs; empty trailing rows are not styled.
	const continuationRows = new Set<number>();
	for (const definition of index.definitions) {
		const first = view.state.doc.lineAt(definition.from);
		const prefix = view.state.sliceDoc(first.from, definition.from);
		for (let number = first.number + 1; number <= view.state.doc.lines; number++) {
			const line = view.state.doc.line(number);
			if (!line.text.startsWith(prefix)) break;
			const text = line.text.slice(prefix.length);
			if (!text.trim()) continue;
			if (!/^(?: {4}|\t)/u.test(text)) break;
			continuationRows.add(line.from);
		}
	}
	syntaxTree(view.state).iterate({ enter(node) {
		if (node.name === 'HyperMD-footnote' && node.to > node.from &&
			continuationRows.has(view.state.doc.lineAt(node.from).from)) {
			ranges.push(Decoration.line({ class: 'paraflow-footnote-row' }).range(view.state.doc.lineAt(node.from).from));
		}
	} });
	const target = view.state.field(highlightField);
	if (target && target.from < target.to) ranges.push(Decoration.mark({ class: 'paraflow-footnote-target' }).range(target.from, target.to));
	return Decoration.set(ranges, true);
}

/** Display original IDs and navigation while leaving native definition rows in place. */
export function createFootnoteExtension(options: FootnoteOptions): Extension {
	const projection = ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		destroyed = false;
		timer: number | undefined;
		activeSource: FootnoteRange | null = null;
		frozenSource: FootnoteRange | null = null;
		pointerPressed: boolean;
		isOwnerActive = (): boolean => !this.destroyed && options.isActive(this.view);
		handleKeydown = (event: KeyboardEvent): void => {
			if (this.navigate(event)) event.stopPropagation();
		};
		constructor(readonly view: EditorView) {
			const initiallyActive = options.isActive(view);
			this.pointerPressed = selectionPointerPressed(view.state);
			this.decorations = this.build();
			// CM attaches its editor classes after the first decoration pass.
			queueMicrotask(() => {
				if (!this.destroyed && initiallyActive !== options.isActive(view)) view.dispatch({});
			});
		}
		update(update: ViewUpdate): void {
			if (options.isActive(this.view) && (this.view.compositionStarted || this.view.composing || requireCompositionState(update.state))) {
				this.decorations = this.decorations.map(update.changes);
				const map = (range: FootnoteRange | null): FootnoteRange | null => range && ({ ...range,
					from: update.changes.mapPos(range.from, 1), to: update.changes.mapPos(range.to, -1) });
				this.activeSource = map(this.activeSource); this.frozenSource = map(this.frozenSource);
				return;
			}
			const pointerPressed = selectionPointerPressed(update.state);
			if (update.docChanged || update.transactions.some(transaction => transaction.reconfigured)) {
				this.activeSource = null;
				this.frozenSource = null;
			} else if (pointerPressed && !this.pointerPressed) this.frozenSource = this.activeSource;
			this.pointerPressed = pointerPressed;
			this.decorations = this.build();
		}
		build(): DecorationSet {
			const state = this.view.state;
			const coverage = selectionProjectionCoverage(state) ?? state.selection;
			if (!options.isActive(this.view) ||
				coverage.ranges.some(range => !range.empty)) this.activeSource = null;
			else {
				const index = state.field(footnoteIndexField);
				const sources = [...index.references, ...index.definitions];
				const caret = state.selection.main;
				const mode = classifyCurrentSelectionMode(state);
				if (this.pointerPressed && renderedSourcePointerPosition(this.view) === caret.head) {
					this.activeSource = sources.find(range => range.from <= caret.head && caret.head <= range.to) ?? null;
					this.frozenSource = this.activeSource;
				} else if (this.pointerPressed) this.activeSource = sources.find(range => editing(this.frozenSource, range)) ?? null;
				else if (mode === 'caret') this.activeSource = sources.find(range => range.from <= caret.head && caret.head <= range.to) ?? null;
				else if (mode !== 'unknown' || state.selection.ranges.length !== 1 || !caret.empty ||
					!this.activeSource || caret.head < this.activeSource.from || caret.head > this.activeSource.to) this.activeSource = null;
			}
			return project(this.view, options, this.handleKeydown, this.activeSource, this.isOwnerActive);
		}
		destroy(): void { this.destroyed = true; this.view.dom.ownerDocument.defaultView!.clearTimeout(this.timer); }
		navigationTarget(event: MouseEvent | KeyboardEvent): NavigationTarget | null {
			const focusedActivation = 'key' in event && (event.key === 'Enter' || event.key === ' ') &&
				!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
				event.target === this.view.dom.ownerDocument.activeElement;
			if ((!isFootnoteNavigationEvent(event) && !focusedActivation) || this.destroyed || this.view.compositionStarted || requireCompositionState(this.view.state) ||
				this.view.composing || !options.isActive(this.view)) return null;
			const ownerWindow = this.view.dom.ownerDocument.defaultView!;
			if (!(event.target instanceof ownerWindow.Element) || !this.view.contentDOM.contains(event.target)) return null;
			const element = event.target.closest<HTMLElement>('[data-footnote-from]');
			const index = this.view.state.field(footnoteIndexField);
			if (element) {
				const from = Number(element.dataset.footnoteFrom);
				const reference = index.references.find(ref => ref.from === from);
				if (reference) return referenceTarget(index, reference);
				const definition = index.definitions.find(def => def.from === from);
				const destination = definition?.references.find(ref => ref.from === Number(element.dataset.footnoteTarget));
				return destination ? { id: destination.id, status: destination.status, destination } : null;
			}
			if (!('clientX' in event)) return null;
			// Editing removes the number mark; the source index still owns modified clicks on a reference.
			const position = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
			const reference = position === null ? undefined : index.references.find(ref => ref.from <= position && position < ref.to);
			return reference ? referenceTarget(index, reference) : null;
		}
		navigate(event: MouseEvent | KeyboardEvent): boolean {
			const target = this.navigationTarget(event);
			if (!target) return false;
			const { status } = target;
			if (status === 'missing' || status === 'duplicate') {
				event.preventDefault();
				options.notify(status === 'missing' ? `找不到脚注定义：${target.id}`
					: `脚注定义重复，无法确定跳转目标：${target.id}`);
				return true;
			}
			const destination = target.destination!;
			const effects: StateEffect<unknown>[] = [highlightEffect.of(destination), EditorView.scrollIntoView(destination.from, { y: 'center' })];
			foldedRanges(this.view.state).between(destination.from, destination.from, (from, to) => {
				if (from <= destination.from && to >= destination.from) effects.push(unfoldEffect.of({ from, to }));
			});
			event.preventDefault();
			this.view.dispatch({ selection: EditorSelection.cursor(destination.from), effects,
				annotations: Transaction.userEvent.of('select') });
			this.view.focus();
			const ownerWindow = this.view.dom.ownerDocument.defaultView!;
			ownerWindow.clearTimeout(this.timer);
			this.timer = ownerWindow.setTimeout(() => { this.view.dispatch({ effects: highlightEffect.of(null) }); }, 900);
			return true;
		}
	}, { decorations: plugin => plugin.decorations });
	return [createInputStateExtension(), createSelectionPresentationSessionExtension(), createRenderedSourceClickExtension(),
		createNativeDecorationOwnership(), nativeInlineOwnership.of((state, view) => {
			if (!options.isActive(view)) return null;
			const index = state.field(footnoteIndexField);
			const markers = [...index.references, ...index.definitions];
			return (from, to, decoration) => isNativeReplacement(decoration) && markers.some(marker => marker.from <= from && to <= marker.to);
		}),
		hoverTooltip((view, position) => {
			if (!options.isActive(view)) return null;
			const index = view.state.field(footnoteIndexField);
			const reference = index.references.find(note => note.from <= position && position <= note.to);
			if (!reference) return null;
			const definition = reference.status === 'resolved' ? index.definitions.find(note => note.id === reference.id) : null;
			return { pos: reference.from, end: reference.to, above: true, arrow: true, create: () => {
				const dom = createDetachedEl(view.dom.ownerDocument, 'div');
				dom.className = 'paraflow-footnote-tooltip';
				const body = dom.appendChild(createDetachedEl(dom.ownerDocument, 'p'));
				body.textContent = definition ? footnoteDefinitionContent(view.state.doc.toString(), definition)
					: reference.status === 'duplicate' ? `脚注定义重复：${reference.id}` : `找不到脚注定义：${reference.id}`;
				if (definition) {
					const hint = dom.appendChild(createDetachedEl(dom.ownerDocument, 'p'));
					hint.className = 'paraflow-footnote-tooltip-hint';
					hint.textContent = '按住 Ctrl/Cmd + 单击 跳转到脚注定义';
				}
				return { dom };
			} };
		}),
		footnoteIndexField, highlightField, projection, Prec.highest(EditorView.domEventHandlers({
		mousedown: (event, view) => view.plugin(projection)!.navigate(event),
		click: (event, view) => {
			if (!view.plugin(projection)!.navigationTarget(event)) return false;
			// The mousedown already navigated or rejected an ambiguous target.
			event.preventDefault();
			return true;
		},
	}))];
}

export { FOOTNOTE_CSS } from './styles.js';
