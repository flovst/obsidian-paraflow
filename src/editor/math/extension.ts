import { containerBlockFrame, wrapContainerBlock, type ContainerFrame } from '../callout/container-surface.js';
import { EditorSelection, EditorState, Prec, StateEffect, StateField, type Extension, type Range, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, keymap, showTooltip, ViewPlugin, WidgetType, type DecorationSet, type Tooltip } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { createNativeDecorationOwnership, nativeBlockOwnership } from '../runtime/native-decoration-ownership.js';
import { classifyCurrentSelectionMode, selectionModeAnnotation } from '../runtime/input-state.js';
import { createInlineRevealPointerExtension, inlineEndpointOwners, inlineRevealPointerHeld } from '../runtime/inline-reveal.js';
import { paragraphNavigationAnnotation } from '../paragraph/edit-plan.js';
import { normalizeParagraphSelectionEndpoint } from '../paragraph/selection-protection.js';
import { beginSourcePointer, selectionPointerPressed, selectionProjectionCoverage } from '../runtime/selection-session.js';
import { discoverMath, discoverParsedMath, type MathExpression } from './syntax.js';
import { confirmMath, createMathCandidateExtension, mathConversionChanges, pendingMathRanges } from './candidate-state.js';
import { documentContentStart, isVirtualTailActive, virtualTailState } from '../runtime/virtual-tail.js';
import { handoffRenderedSourceGesture } from '../runtime/rendered-source-click.js';
import { mathTooltipPosition } from './tooltip.js';
import { createMathKeyboardEntry } from './navigation.js';
import { createCreationHistory, creationHistory } from '../runtime/creation-history.js';
import { clampMathBody, projectMathSource, type MathSource } from './source.js';
import { deleteAdjacentMath, deleteEmptyMath, editMathBody, insertMathTab, mathBlockEdit } from './operations.js';
import { mathDraftRanges, mathNativeOwnership } from './native-ownership.js';
import { createBlockBodySelection } from '../runtime/block-selection.js';
import { blockContinuationPrefix } from '../runtime/block-body.js';
import { mathEditingActivation } from './activation.js';

export interface MathEditingOptions {
	readonly isEnabled?: () => boolean;
	/** Display ownership for an enabled Live Preview editor, independent of focus. */
	readonly isStateActive: (state: EditorState) => boolean;
	readonly isFocused?: (state: EditorState) => boolean;
	readonly renderMath: (source: string, display: boolean, document?: Document) => HTMLElement | Promise<HTMLElement>;
	readonly getCachedMath?: (source: string, display: boolean, document?: Document) => HTMLElement | undefined;
	readonly finishRenderMath?: () => Promise<void>;
}

interface MathProjection {
	readonly previewRevision: number;
	readonly active: MathExpression | null;
	readonly frozen: MathExpression | null;
	readonly pressed: boolean;
	readonly held: boolean;
	readonly inlineActive: readonly MathExpression[];
	readonly inlineFrozen: readonly MathExpression[];
	readonly decorations: DecorationSet;
	readonly tooltip: Tooltip | null;
	readonly activeSource: string | null;
}

const refreshMathPreview = StateEffect.define<null>();

const previewUpdates = ViewPlugin.define(view => {
	const pending = new Map<() => boolean, boolean>();
	const owner = view.dom.ownerDocument.defaultView!;
	let frame: number | null = null;
	return {
		schedule(isAlive: () => boolean, contentWidget: boolean) {
			pending.set(isAlive, contentWidget);
			frame ??= owner.requestAnimationFrame(() => {
				frame = null;
				const live = [...pending].filter(([isAlive]) => isAlive());
				pending.clear();
				// Publish a widget revision to invalidate CodeMirror's cached block heights.
				if (live.some(([, content]) => content)) view.dispatch({ effects: refreshMathPreview.of(null) });
				else if (live.length) view.requestMeasure();
			});
		},
		destroy() {
			if (frame !== null) owner.cancelAnimationFrame(frame);
			pending.clear();
		},
	};
});

function renderPreview(view: EditorView, source: string, display: boolean,
	className: string, options: MathEditingOptions, contentWidget = false): { dom: HTMLElement; render: (source: string) => void; destroy: () => void } {
	const dom = view.dom.ownerDocument.createElement(display ? 'div' : 'span');
	dom.className = className;
	dom.contentEditable = 'false';
	dom.setAttribute('role', 'math');
	if (className === 'paraflow-math-tooltip') {
		dom.addEventListener('mousedown', event => {
			if ((event as MouseEvent).button === 0) event.preventDefault();
		});
	}
	let alive = true;
	let revision = 0;
	const rendered = (): void => {
		queueMicrotask(() => { if (alive) view.plugin(previewUpdates)!.schedule(() => alive, contentWidget); });
	};
	const render = (source: string): void => {
		const request = ++revision;
		const current = (): boolean => alive && request === revision;
		dom.setAttribute('aria-description', source);
		dom.dataset.renderState = 'loading';
		dom.setAttribute('aria-busy', 'true');
		dom.classList.remove('paraflow-math-error');
		const showError = (error: unknown): void => {
			if (!current()) return;
			dom.dataset.renderState = 'error';
			dom.removeAttribute('aria-busy');
			dom.classList.add('paraflow-math-error');
			dom.textContent = `无法预览此公式${error instanceof Error ? `：${error.message}` : ''}`;
			rendered();
		};
		const ready = (): void => {
			if (!current()) return;
			dom.dataset.renderState = 'ready';
			dom.removeAttribute('aria-busy');
			rendered();
		};
		const attach = (result: HTMLElement, cached = false): void => {
			if (!current()) return;
			dom.replaceChildren(result);
			if (!cached && options.finishRenderMath) void options.finishRenderMath().then(ready, showError);
			else ready();
		};
		try {
			const cached = options.getCachedMath?.(source, display, view.dom.ownerDocument);
			if (cached) { attach(cached, true); return; }
			const result = options.renderMath(source, display, view.dom.ownerDocument);
			if ('then' in result) void result.then(result => attach(result), showError);
			else attach(result);
		} catch (error) { showError(error); }
	};
	render(source);
	return { dom, render, destroy: () => { alive = false; } };
}

const previews = new WeakMap<HTMLElement, ReturnType<typeof renderPreview>>();
const previewWidgets = new WeakMap<HTMLElement, MathWidget>();
const previewOwners = new WeakMap<HTMLElement, { readonly from: number; readonly to: number }>();

/** Only a replacement owns source; the active-source companion is a point widget. */
export function mathPreviewReplacementOwner(dom: HTMLElement): { readonly from: number; readonly to: number } | undefined {
	return previewOwners.get(dom);
}

class MathWidget extends WidgetType {
	constructor(readonly source: string, readonly display: boolean, readonly options: MathEditingOptions, readonly frame: ContainerFrame | null,
		readonly revision: number, readonly owner?: { readonly from: number; readonly to: number }) { super(); }
	eq(other: MathWidget): boolean {
		return this.revision === other.revision && this.sameContent(other);
	}
	private sameContent(other: MathWidget): boolean {
		return this.source === other.source && this.display === other.display && this.options === other.options && this.frame?.key === other.frame?.key &&
			this.owner?.from === other.owner?.from && this.owner?.to === other.owner?.to;
	}
	toDOM(view: EditorView): HTMLElement {
		const result = renderPreview(view, this.source, this.display,
			'paraflow-math-rendered' + (this.display ? ' paraflow-math-block-preview' : ' math-inline'), this.options, true);
		const dom = wrapContainerBlock(view, result.dom, this.frame);
		if (this.owner) previewOwners.set(result.dom, this.owner);
		previews.set(dom, result);
		previewWidgets.set(dom, this);
		return dom;
	}
	updateDOM(dom: HTMLElement): boolean {
		const previous = previewWidgets.get(dom)!;
		if (this.display !== previous.display || this.options !== previous.options || this.frame?.key !== previous.frame?.key) return false;
		const preview = previews.get(dom)!;
		if (this.owner) previewOwners.set(preview.dom, this.owner);
		else previewOwners.delete(preview.dom);
		if (this.source !== previous.source) preview.render(this.source);
		previewWidgets.set(dom, this);
		return true;
	}
	destroy(dom: HTMLElement): void { previews.get(dom)!.destroy(); }
	ignoreEvent(): boolean { return false; }
}

function matching(expressions: readonly MathExpression[], previous: MathExpression | null): MathExpression | null {
	return previous ? expressions.find(math => math.from === previous.from && math.to === previous.to &&
		math.display === previous.display) ?? null : null;
}

function bodyRange(state: EditorState, math: MathExpression): { from: number; to: number } {
	return projectMathSource(state, math);
}

function navigationHead(transaction: Transaction, body: MathSource, head: number): number {
	let next = clampMathBody(body, head);
	const before = transaction.startState.selection.main;
	const keyboard = transaction.isUserEvent('move') ||
		transaction.isUserEvent('select') && !transaction.isUserEvent('select.pointer');
	if (!keyboard || before.head < body.from || before.head > body.to) return next;
	// Native Shift+Up/Down uses the select event and carries its vertical goal column.
	const nativeVertical = transaction.isUserEvent('select') && transaction.newSelection.main.goalColumn !== undefined;
	const operation = transaction.annotation(paragraphNavigationAnnotation) ??
		(nativeVertical ? head < before.head ? 'up' : 'down' : undefined);
	const row = body.bodyLines.findIndex(line => line.from <= before.head && before.head <= line.to);
	if (row > 0 && before.head === body.bodyLines[row]!.from && head >= body.bodyLines[row]!.prefixFrom && head < before.head) next = body.bodyLines[row - 1]!.to;
	const exitsBefore = before.head === body.from || operation === 'up' && row === 0;
	const exitsAfter = before.head === body.to || operation === 'down' && row === body.bodyLines.length - 1;
	if (head < body.from && exitsBefore && body.before !== null) next = normalizeParagraphSelectionEndpoint(transaction.state, body.before, -1);
	if (head > body.to && exitsAfter && body.after !== null) next = normalizeParagraphSelectionEndpoint(transaction.state, body.after, 1);
	return next;
}

function previewFrom(math: MathExpression, source: MathSource): number {
	const opening = source.lines[0]!;
	return math.display && math.from === opening.prefixTo ? opening.prefixFrom : math.from;
}

class MathBoundary extends WidgetType {
	constructor(readonly side: 'open' | 'close') { super(); }
	eq(other: MathBoundary): boolean { return this.side === other.side; }
	toDOM(view: EditorView): HTMLElement {
		const dom = view.dom.ownerDocument.createElement('span');
		dom.className = `paraflow-math-boundary paraflow-math-boundary-${this.side}`;
		dom.contentEditable = 'false';
		dom.textContent = '$$';
		dom.setAttribute('aria-hidden', 'true');
		return dom;
	}
	ignoreEvent(): boolean { return false; }
}

class MathBadge extends WidgetType {
	toDOM(view: EditorView): HTMLElement {
		const dom = view.dom.ownerDocument.createElement('span');
		dom.className = 'paraflow-math-badge';
		dom.textContent = '公式';
		dom.contentEditable = 'false';
		dom.setAttribute('aria-hidden', 'true');
		return dom;
	}
}

function buildProjection(state: EditorState, options: MathEditingOptions,
	previous: MathProjection | null, frozen: MathExpression | null,
	inlineFrozen: readonly MathExpression[], previewRevision = 0): MathProjection {
	const pressed = selectionPointerPressed(state);
	const held = inlineRevealPointerHeld(state);
	if (!options.isStateActive(state)) return { previewRevision, active: null, frozen: null, pressed, held, inlineActive: [], inlineFrozen: [],
		decorations: Decoration.none, tooltip: null, activeSource: null };
	const expressions = discoverMath(state);
	const caret = state.selection.main;
	const mode = classifyCurrentSelectionMode(state);
	const covered = selectionProjectionCoverage(state)?.ranges.some(range => !range.empty) ?? false;
	const nonempty = state.selection.ranges.some(range => !range.empty);
	const explicit = mode === 'caret' ? expressions.find(math => math.from <= caret.head && caret.head <= math.to) ?? null : null;
	const synchronized = mode === 'unknown' && state.selection.ranges.length === 1 && caret.empty &&
		previous?.active && previous.active.from <= caret.head && caret.head <= previous.active.to
		? matching(expressions, previous.active) : null;
	const internalRange = nonempty && previous?.active?.display && state.selection.ranges.every(range => {
		const body = bodyRange(state, previous.active!);
		return range.from >= body.from && range.to <= body.to;
	}) ? matching(expressions, previous.active) : null;
	const focused = options.isFocused?.(state) !== false && !isVirtualTailActive(state);
	// Math's delimiter edges are explicit entry points, like its collapsed caret edges.
	const endpointMath = inlineEndpointOwners(state, expressions.filter(math => !math.display)
		.map(math => ({ ...math, bodies: [{ from: math.from, to: math.to }], math }))).map(owner => owner.math);
	const inlineActive = !focused ? [] : held
		? inlineFrozen.map(math => matching(expressions, math)).filter((math): math is MathExpression => math !== null)
		: endpointMath.length ? endpointMath : !nonempty && !covered && synchronized && !synchronized.display ? [synchronized] : [];
	const blockActive = pressed ? matching(expressions, frozen)
		: internalRange ?? (covered || nonempty ? null : explicit ?? synchronized);
	const active = !focused ? null : blockActive?.display ? blockActive
		: inlineActive.find(math => math.from <= caret.head && caret.head <= math.to) ?? inlineActive[0] ?? null;
	const decorations: Range<Decoration>[] = [];
	for (const pending of pendingMathRanges(state)) {
		for (let number=state.doc.lineAt(pending.from).number;number<=state.doc.lineAt(pending.to).number;number++)
			decorations.push(Decoration.line({class:'paraflow-math-pending'}).range(state.doc.line(number).from));
	}
	for (const draft of mathDraftRanges(state)) {
		decorations.push(Decoration.mark({ class: 'paraflow-math-draft' }).range(draft.from, draft.to));
	}
	for (const math of expressions) {
		const mapped = projectMathSource(state, math), source = mapped.source;
		if (math === active || inlineActive.includes(math)) {
			decorations.push(Decoration.mark({ class: math.display ? 'paraflow-math-source' : 'paraflow-math-source paraflow-math-source-inline' }).range(math.from, math.to));
			decorations.push((math.display ? Decoration.replace({ widget: new MathBoundary('open') })
				: Decoration.mark({ class: 'paraflow-math-delimiter paraflow-math-delimiter-open' })).range(math.from, math.contentFrom),
				(math.display ? Decoration.replace({ widget: new MathBoundary('close') })
					: Decoration.mark({ class: 'paraflow-math-delimiter' })).range(math.contentTo, math.to));
			for (const line of mapped.lines) for (const token of line.text.matchAll(/\\(?:[A-Za-z]+|.)|[{}[\]()^_&=+-]|\d+(?:\.\d+)?/gu)) {
				const kind = token[0].startsWith('\\') ? 'command' : /^\d/u.test(token[0]) ? 'number' : 'punctuation';
				decorations.push(Decoration.mark({ class: `paraflow-math-${kind}` }).range(line.from + token.index, line.from + token.index + token[0].length));
			}
			if (math.display) {
				decorations.push(Decoration.widget({ widget: new MathBadge(), side: -1 }).range(math.from));
				decorations.push(Decoration.widget({ widget: new MathWidget(source, true, options, containerBlockFrame(state, math.from, math.to), previewRevision), block: true, side: 1 }).range(math.to));
				const opening = state.doc.lineAt(math.from);
				const closing = state.doc.lineAt(math.to);
				const contentStart = mapped.bodyLines[0]?.number ?? opening.number + 1;
				const contentEnd = mapped.bodyLines.at(-1)?.number ?? closing.number - 1;
				for (let number = opening.number; number <= closing.number; number += 1) {
					const first = number === opening.number;
					const last = number === closing.number;
					const attributes: Record<string, string> = number >= contentStart && number <= contentEnd
						? { 'data-paraflow-math-line': String(number - contentStart + 1) } : {};
					decorations.push(Decoration.line({ class: 'paraflow-math-source-block' +
						(first ? ' paraflow-math-source-start' : '') +
						(first && contentStart === opening.number ? ' paraflow-math-source-start-inline' : '') +
						(last && contentEnd === closing.number ? ' paraflow-math-source-end-inline' : '') +
						(last ? ' paraflow-math-source-end' : ''), attributes }).range(state.doc.line(number).from));
				}
			}
		} else {
			const edge = state.field(virtualTailState, false);
			decorations.push(Decoration.replace({ widget: new MathWidget(source, math.display, options, math.display ? containerBlockFrame(state, math.from, math.to) : null, previewRevision, math),
				block: math.display,
				inclusiveStart: edge?.side === 'before' && math.from === documentContentStart(state) ? false : undefined,
				inclusiveEnd: math.display && !(edge && edge.side !== 'before' && math.to === state.doc.length),
			}).range(previewFrom(math, mapped), math.to));
		}
	}
	const activeSource = active ? projectMathSource(state, active).source : null;
	const tooltip: Tooltip | null = active && !active.display ?
		previous?.tooltip && matching([active], previous.active) && previous.activeSource === activeSource
			? previous.tooltip : {
		pos: active.from, end: active.to, above: false, strictSide: false, arrow: true,
		create: view => {
			const preview = renderPreview(view, activeSource!, false, 'paraflow-math-tooltip', options);
			return { ...preview, ...mathTooltipPosition(view, active, preview.dom) };
		},
	} : null;
	return { previewRevision, active, activeSource, frozen, pressed, held, inlineActive, inlineFrozen: focused ? inlineFrozen : [],
		decorations: Decoration.set(decorations, true), tooltip };
}

/** Compose before structural Tab owners; the remaining math keys retain their order. */
export function createMathTabExtension(isActive: (view: EditorView) => boolean): Extension {
	return Prec.highest(keymap.of([{ key: 'Tab', run: view => isActive(view) && insertMathTab(view) }]));
}

export function createMathEditingExtension(options: MathEditingOptions): Extension {
	const createMath = (view: EditorView): boolean => {
		const state = view.state, caret = state.selection.main;
		if (!options.isStateActive(state) || state.readOnly || view.composing || state.selection.ranges.length !== 1 || !caret.empty) return false;
		const draft = mathDraftRanges(state).find(range => range.to === caret.head && range.to - range.from === 2);
		if (!draft) return false;
		const paired = discoverParsedMath(state).find(math => math.display && math.from <= draft.from && draft.to <= math.to);
		if (paired) {
			const changes = state.changes(mathConversionChanges(state, [paired]));
			const opening = state.doc.lineAt(paired.from), prefix = state.sliceDoc(opening.from, paired.from);
			view.dispatch({ changes, selection: { anchor: changes.mapPos(opening.to + 1, -1) + prefix.length },
				effects: confirmMath.of(paired.from), userEvent: 'input.math-convert',
				annotations: [isolateHistory.of('full'), selectionModeAnnotation.of('normal')] });
			return true;
		}
		const line = state.doc.lineAt(caret.head), prefix = state.sliceDoc(line.from, draft.from), insert = `\n${prefix}\n${prefix}$$`;
		view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + 1 + prefix.length },
			effects: creationHistory.of({ owner: 'math', from: line.from, draftOffset: line.length, bodyOffset: line.length + 1 + prefix.length, created: true }),
			userEvent: 'input.math-create', annotations: [isolateHistory.of('full'), selectionModeAnnotation.of('normal')] });
		return true;
	};
	const refreshFocus = StateEffect.define<null>();
	const projection = StateField.define<MathProjection>({
		create: state => buildProjection(state, options, null, null, []),
		update(value, transaction) {
			if (!transaction.docChanged && !transaction.selection && !transaction.reconfigured &&
				transaction.effects.length > 0 && transaction.effects.every(effect => effect.is(refreshMathPreview))) {
				const previewRevision = value.previewRevision + 1;
				const decorations: Range<Decoration>[] = [];
				for (let cursor = value.decorations.iter(); cursor.value; cursor.next()) {
					const decoration = cursor.value;
					const spec = decoration.spec as Parameters<typeof Decoration.widget>[0] & Parameters<typeof Decoration.replace>[0];
					const widget = spec.widget;
					if (widget instanceof MathWidget) {
						const next = { ...spec, widget: new MathWidget(widget.source, widget.display, widget.options,
							widget.frame, previewRevision, widget.owner) };
						decorations.push((cursor.from === cursor.to ? Decoration.widget(next) : Decoration.replace(next)).range(cursor.from, cursor.to));
					} else decorations.push(decoration.range(cursor.from, cursor.to));
				}
				return { ...value, previewRevision, decorations: Decoration.set(decorations, true) };
			}
			const pressed = selectionPointerPressed(transaction.state);
			const sourceEntry = transaction.effects.some(effect => effect.is(beginSourcePointer));
			const frozen = sourceEntry ? (isVirtualTailActive(transaction.state) ? null : discoverMath(transaction.state).find(math =>
				math.display && math.from <= transaction.newSelection.main.head && transaction.newSelection.main.head <= math.to) ?? null)
				: transaction.docChanged || transaction.reconfigured ? null
				: pressed && !value.pressed ? value.active : value.frozen;
			const held = inlineRevealPointerHeld(transaction.state);
			const captured = held && !value.held ? value.inlineActive : value.inlineFrozen;
			const inlineFrozen = transaction.docChanged ? captured.map(math => ({ ...math,
				from: transaction.changes.mapPos(math.from, 1), to: transaction.changes.mapPos(math.to, -1),
				contentFrom: transaction.changes.mapPos(math.contentFrom, 1), contentTo: transaction.changes.mapPos(math.contentTo, -1),
			})) : captured;
			const revision = value.previewRevision + Number(transaction.effects.some(effect => effect.is(refreshMathPreview)));
			// Host edits may omit input intent. Retain only the mapped, already active owner.
			const active = value.active && transaction.docChanged ? { ...value.active,
				from: transaction.changes.mapPos(value.active.from, 1), to: transaction.changes.mapPos(value.active.to, -1),
				contentFrom: transaction.changes.mapPos(value.active.contentFrom, -1), contentTo: transaction.changes.mapPos(value.active.contentTo, 1),
			} : value.active;
			return buildProjection(transaction.state, options, { ...value, active }, frozen, inlineFrozen, revision);
		},
		provide: field => [Prec.highest(EditorView.decorations.from(field, value => value.decorations)),
			showTooltip.from(field, value => value.tooltip)],
	});
	const pointerEntry = ViewPlugin.define(view => {
		let gesture: { x: number; y: number; math: MathExpression; dragged: boolean } | null = null;
		const plain = (event: MouseEvent): boolean => event.button === 0 && !event.shiftKey &&
			!event.ctrlKey && !event.metaKey && !event.altKey && event.detail <= 1 && !view.composing;
		const previewAt = (event: MouseEvent): Element | null => {
			const target = event.target as Element;
			if (target.closest('.cm-editor') !== view.dom) return null;
			return target.closest('.paraflow-math-rendered, .math-inline, .math-block.cm-embed-block');
		};
		const down = (event: MouseEvent): void => {
			gesture = null;
			if (!plain(event) || !options.isStateActive(view.state)) return;
			const block = previewAt(event);
			if (!block || !view.contentDOM.contains(block)) return;
			const position = view.posAtDOM(block);
			const math = discoverMath(view.state).find(item => previewFrom(item, projectMathSource(view.state, item)) <= position && position <= item.to);
			if (math?.display) {
				const active = view.state.field(projection).active;
				const source = projectMathSource(view.state, math);
				const head = active?.from === math.from ? clampMathBody(source, view.state.selection.main.head) : source.from;
				handoffRenderedSourceGesture(view, event, head, () => options.isStateActive(view.state));
				return;
			}
			if (math) gesture = { x: event.clientX, y: event.clientY, math, dragged: false };
		};
		const move = (event: MouseEvent): void => {
			if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 4) gesture.dragged = true;
		};
		const click = (event: MouseEvent): void => {
			move(event);
			const candidate = gesture; gesture = null;
			if (!candidate || candidate.dragged || !plain(event)) return;
			const block = previewAt(event);
			if (!block || !view.contentDOM.contains(block)) return;
			const math = matching(discoverMath(view.state), candidate.math);
			if (!math) return;
			const position = view.posAtDOM(block);
			if (position < previewFrom(math, projectMathSource(view.state, math)) || position > math.to) return;
			view.focus();
			if (!options.isStateActive(view.state) || options.isFocused?.(view.state) === false) return;
			event.preventDefault(); event.stopImmediatePropagation();
			const active = view.state.field(projection).active;
			const head = active?.from === math.from ? view.state.selection.main.head
				: projectMathSource(view.state, math).from;
			view.dispatch({ selection: { anchor: head }, userEvent: 'select', scrollIntoView: true });
		};
		view.dom.addEventListener('mousedown', down, true);
		view.dom.ownerDocument.addEventListener('mousemove', move, true);
		view.dom.addEventListener('click', click, true);
		return { destroy() {
			view.dom.removeEventListener('mousedown', down, true);
			view.dom.ownerDocument.removeEventListener('mousemove', move, true);
			view.dom.removeEventListener('click', click, true);
		} };
	});
	const protectBoundaries = Prec.lowest(EditorState.transactionFilter.of(transaction => {
		if (!options.isStateActive(transaction.startState)) return transaction;
		if (transaction.annotation(mathBlockEdit)) return transaction;
		if (isVirtualTailActive(transaction.state)) return transaction;
		const selection = transaction.newSelection;
		if (!transaction.docChanged && transaction.selection && selection.ranges.some(range => !range.empty)) {
			const active = transaction.startState.field(projection).active;
			if (!active?.display) return transaction;
			const body = projectMathSource(transaction.startState, active);
			const ranges = selection.ranges.map(range => {
				// A document selection entering/leaving the whole block retains its exact source.
				if (range.from < active.from || range.to > active.to || range.from === active.from && range.to === active.to) return range;
				const clamp = (pos: number): number => clampMathBody(body, pos);
				const head = navigationHead(transaction, body, range.head);
				return EditorSelection.range(clamp(range.anchor), head, range.goalColumn, range.bidiLevel ?? undefined);
			});
			const next = EditorSelection.create(ranges, selection.mainIndex);
			return selection.eq(next) ? transaction : [transaction, { selection: next }];
		}
		if (selection.ranges.length !== 1 || !selection.main.empty) return transaction;
		if (transaction.docChanged) {
			if (!transaction.startState.selection.main.empty || !transaction.isUserEvent('delete')) return transaction;
			let boundary = false;
			for (const math of discoverMath(transaction.startState).filter(item => item.display)) {
				const body = projectMathSource(transaction.startState, math);
				transaction.changes.iterChangedRanges((from, to) => {
					if (from < body.from && to > math.from || from < math.to && to > body.to) boundary = true;
					if (body.bodyLines.some(line => line.prefixTo > line.prefixFrom && from < line.prefixTo && to > line.prefixFrom)) boundary = true;
				});
			}
			return boundary ? [] : transaction;
		}
		if (!transaction.selection) return transaction;
		const head = selection.main.head;
		const math = discoverMath(transaction.startState).find(item => item.display && item.from <= head && head <= item.to);
		if (!math) return transaction;
		const body = projectMathSource(transaction.startState, math);
		const next = navigationHead(transaction, body, head);
		return next === head ? transaction : [transaction, { selection: EditorSelection.create([EditorSelection.cursor(next, selection.main.assoc, selection.main.bidiLevel ?? undefined, selection.main.goalColumn)]) }];
	}));
	return [mathEditingActivation.of(options.isEnabled ?? (() => true)), createMathCandidateExtension(options.isStateActive), createInlineRevealPointerExtension(), projection, previewUpdates, pointerEntry, protectBoundaries, createMathKeyboardEntry(options.isStateActive), createCreationHistory('math', options.isStateActive),
		createBlockBodySelection(view => {
			if (!options.isStateActive(view.state) || view.composing || isVirtualTailActive(view.state)) return null;
			const active = view.state.field(projection).active;
			if (!active?.display) return null;
			const body = projectMathSource(view.state, active);
			const prefix = blockContinuationPrefix(view.state, active.from);
			return { ...body, lines: body.bodyLines, prefix,
				materializeAfter: body.bodyLines.length ? undefined : '\n' + prefix };
		}),
		Prec.highest(keymap.of([{ key: 'Enter', run: view => editMathBody(view, 'Enter', options.isStateActive, view.state.field(projection).active) || createMath(view) },
			{ key: 'Shift-Enter', run: view => editMathBody(view, 'Shift-Enter', options.isStateActive, view.state.field(projection).active) },
			{ key: 'Backspace', run: view => editMathBody(view, 'Backspace', options.isStateActive, view.state.field(projection).active) || deleteEmptyMath(view, options.isStateActive, view.state.field(projection).active) || deleteAdjacentMath(view, false, options.isStateActive) },
			{ key: 'Delete', run: view => editMathBody(view, 'Delete', options.isStateActive, view.state.field(projection).active) || deleteAdjacentMath(view, true, options.isStateActive) }])),
		createNativeDecorationOwnership(), nativeBlockOwnership.of(state => {
			if (!options.isStateActive(state)) return null;
			return mathNativeOwnership(state);
		}), EditorView.editorAttributes.of(view =>
		({ class: options.isStateActive(view.state) ? 'paraflow-math-active' : '' })),
		EditorView.focusChangeEffect.of(() => refreshFocus.of(null))];
}
