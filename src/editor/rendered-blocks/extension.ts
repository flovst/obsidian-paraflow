import { containerBlockFrame, wrapContainerBlock, type ContainerFrame } from '../callout/container-surface.js';
import { EditorState, Prec, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { createNativeDecorationOwnership, isNativeReplacement, nativeBlockOwnership } from '../runtime/native-decoration-ownership.js';
import { selectionPointerPressed } from '../runtime/selection-session.js';
import { codeEditableSelection } from '../code-blocks/editable-boundaries.js';
import type { CodeBlock } from '../code-blocks/model.js';
import { discoverRenderedBlocks, htmlSourceTokens, type RenderedBlock } from './model.js';
import { destroyMermaidPreviews, mermaidThemeStylesChanged, mountMermaidPreview, refreshMermaidPreviews } from './mermaid-preview.js';
export { renderedBlockEditorStyles } from './styles.js';
export interface RenderedBlockEditingOptions {
	isStateActive: (state: EditorState) => boolean;
	isActive: (view: EditorView) => boolean;
	isViewSupported: (view: EditorView) => boolean;
	sourcePath?: (view: EditorView) => string;
	renderMarkdown: (source: string, target: HTMLElement, view: EditorView, kind: 'html' | 'mermaid') => { ready: Promise<void>; destroy(): void };
}
const interactive = 'summary,a,button,input,textarea,select,audio,video,[contenteditable="true"],[role="button"]';
const cleanup = new WeakMap<HTMLElement, () => void>();
const previewWidgets = new WeakMap<HTMLElement, PreviewWidget>();
const mermaidCurrent = new WeakMap<HTMLElement, () => boolean>();
const refreshPreview = StateEffect.define<null>();
function label(kind: RenderedBlock['kind']): string { return kind === 'html' ? 'HTML' : 'Mermaid'; }
function badge(view: EditorView, block: RenderedBlock): HTMLElement {
	const element = view.dom.ownerDocument.createElement('button');
	element.type = 'button'; element.className = 'paraflow-rendered-block-badge';
	element.textContent = `${label(block.kind)} </>`;
	element.dataset.paraflowRenderedFrom = String(block.from);
	element.setAttribute('aria-label', `编辑 ${label(block.kind)} 源码`);
	element.contentEditable = 'false';
	return element;
}
class BadgeWidget extends WidgetType {
	constructor(readonly block: RenderedBlock) { super(); }
	eq(other: BadgeWidget): boolean { return this.block.from === other.block.from && this.block.kind === other.block.kind; }
	toDOM(view: EditorView): HTMLElement { return badge(view, this.block); }
	ignoreEvent(): boolean { return true; }
}
class FenceWidget extends WidgetType {
	constructor(readonly block: RenderedBlock, readonly opening: boolean) { super(); }
	eq(other: FenceWidget): boolean { return this.opening === other.opening && this.block.from === other.block.from && this.block.lines.length === other.block.lines.length; }
	toDOM(view: EditorView): HTMLElement {
		const element = view.dom.ownerDocument.createElement('div');
		element.className = 'paraflow-rendered-block-fence'; element.contentEditable = 'false';
		if (this.opening && !this.block.lines.length) {
			const input = view.dom.ownerDocument.createElement('button'); input.type = 'button'; input.textContent = '输入图表源码';
			input.addEventListener('click', () => {
				const fence = this.block.fence!; const insert = '\n' + fence.continuation;
				view.dispatch({ changes: { from: fence.openingTo, insert }, selection: { anchor: fence.openingTo + insert.length }, userEvent: 'input' });
				view.focus();
			});
			element.append(input); element.classList.add('paraflow-rendered-block-empty');
		}
		return element;
	}
	ignoreEvent(event: Event): boolean { return (event.target as Element).closest('button') !== null; }
}
class PreviewWidget extends WidgetType {
	constructor(readonly block: RenderedBlock, readonly editing: boolean, readonly options: RenderedBlockEditingOptions, readonly frame: ContainerFrame | null,
		readonly revision: number) { super(); }
	eq(other: PreviewWidget): boolean {
		return this.revision === other.revision && this.sameContent(other);
	}
	private sameContent(other: PreviewWidget): boolean {
		return this.block.from === other.block.from && this.block.source === other.block.source && this.block.kind === other.block.kind && this.editing === other.editing && this.options === other.options && this.frame?.key === other.frame?.key;
	}
	toDOM(view: EditorView): HTMLElement {
		const owner = view.dom.ownerDocument;
		const element = owner.createElement('div');
		element.className = `paraflow-rendered-block-preview paraflow-rendered-block-${this.block.kind}` + (this.editing ? ' is-editing' : '');
		element.dataset.paraflowRenderedFrom = String(this.block.from);
		element.setAttribute('contenteditable', 'false');
		if (!this.editing) element.append(badge(view, this.block));
		const content = owner.createElement('div'); content.className = 'paraflow-rendered-block-content markdown-rendered'; element.append(content);
		this.render(element, view);
		return wrapContainerBlock(view, element, this.frame);
	}
	updateDOM(root: HTMLElement, view: EditorView): boolean {
		if (root.dataset.paraflowContainerFrame !== this.frame?.key) return false;
		const element = root.classList.contains('paraflow-container-block') ? root.lastElementChild as HTMLElement : root;
		if (!element.classList.contains(`paraflow-rendered-block-${this.block.kind}`) ||
			element.classList.contains('is-editing') !== this.editing || Number(element.dataset.paraflowRenderedFrom) !== this.block.from) return false;
		if (this.sameContent(previewWidgets.get(element)!) && (this.block.kind !== 'mermaid' || mermaidCurrent.get(element)!())) {
			previewWidgets.set(element, this);
			return true;
		}
		if (this.block.kind !== 'mermaid') cleanup.get(element)!();
		this.render(element, view);
		return true;
	}
	private render(element: HTMLElement, view: EditorView): void {
		previewWidgets.set(element, this);
		const content = element.querySelector<HTMLElement>('.paraflow-rendered-block-content')!;
		if (this.block.kind === 'mermaid') {
			const mount = mountMermaidPreview(element, view, this.options, this.block.source, this.block.from,
				() => view.dispatch({ effects: refreshPreview.of(null) }));
			mermaidCurrent.set(element, mount.current); cleanup.set(element, mount.destroy);
			return;
		}
		element.dataset.renderState = 'loading'; element.setAttribute('aria-busy', 'true');
		// Each async generation receives a detached target. A stale renderer cannot
		// overwrite the current widget, even if its cancellation is best-effort.
		const stage = element.ownerDocument.createElement('div'); stage.className = 'markdown-rendered';
		let alive = true;
		let render: ReturnType<RenderedBlockEditingOptions['renderMarkdown']> | null = null;
		const rendered = (): void => {
			// Changing the decoration invalidates content heights even when flex
			// stretching keeps the overall editor height unchanged.
			queueMicrotask(() => { if (alive) view.dispatch({ effects: refreshPreview.of(null) }); });
		};
		const failed = (error: unknown): void => {
			if (!alive) return;
			element.dataset.renderState = 'error'; element.removeAttribute('aria-busy');
			content.textContent = `无法预览 ${label(this.block.kind)}${error instanceof Error ? `：${error.message}` : ''}`;
			rendered();
		};
		try {
			render = this.options.renderMarkdown(this.block.source, stage, view, this.block.kind);
			void render.ready.then(() => {
				if (!alive) return;
				content.replaceChildren(...stage.childNodes); element.dataset.renderState = 'ready'; element.removeAttribute('aria-busy');
				rendered();
			}, failed);
		} catch (error) { failed(error); }
		cleanup.set(element, () => { alive = false; render?.destroy(); });
	}
	destroy(root: HTMLElement): void {
		const element = root.classList.contains('paraflow-container-block') ? root.lastElementChild as HTMLElement : root;
		cleanup.get(element)!(); cleanup.delete(element); mermaidCurrent.delete(element);
	}
	ignoreEvent(event: Event): boolean { return Boolean((event.target as Element).closest(interactive)?.closest('.paraflow-rendered-block-preview')); }
}
interface Projection {
	previewRevision: number; enabled: boolean; focused: boolean; active: RenderedBlock | null; pressed: boolean; frozen: RenderedBlock | null; decorations: DecorationSet;
}
function same(blocks: readonly RenderedBlock[], block: RenderedBlock | null): RenderedBlock | null {
	return block ? blocks.find(candidate => candidate.from === block.from && candidate.kind === block.kind) ?? null : null;
}
function boundaries(blocks: readonly RenderedBlock[]): CodeBlock[] {
	return blocks.filter(block => block.kind === 'mermaid' && block.fence).map(block => ({ from: block.from, to: block.to,
		closed: true, indented: false, barAt: block.fence!.closingFrom,
		lines: block.lines.map(line => ({ from: line.contentFrom, to: line.to, number: line.number })) }));
}
function project(state: EditorState, options: RenderedBlockEditingOptions, previous: Projection | null,
	enabled: boolean, focused: boolean, previewRevision = 0): Projection {
	const pressed = selectionPointerPressed(state);
	const frozen = pressed ? previous?.pressed ? previous.frozen : previous?.active ?? null : null;
	if (!enabled || !options.isStateActive(state)) return { previewRevision, enabled, focused, active: null, pressed, frozen: null, decorations: Decoration.none };
	const blocks = discoverRenderedBlocks(state), selection = state.selection.main;
	const caret = selection.empty ? blocks.find(block => block.from <= selection.head && selection.head <= block.to) ?? null : null;
	const old = same(blocks, previous?.active ?? null);
	const selected = old && state.selection.ranges.some(range => !range.empty && range.from < old.to && range.to > old.from) ? old : null;
	const active = !focused ? null : pressed ? same(blocks, frozen) : selected ?? caret;
	const ranges: Range<Decoration>[] = [];
	for (const block of blocks) {
		if (block !== active) {
			ranges.push(Decoration.replace({ widget: new PreviewWidget(block, false, options, containerBlockFrame(state, block.from, block.to), previewRevision), block: true, inclusiveEnd: false }).range(block.from, block.to));
			continue;
		}
		for (const line of block.lines) {
			const first = line === block.lines[0], last = line === block.lines.at(-1);
			ranges.push(Decoration.line({ class: `paraflow-rendered-source-line paraflow-rendered-source-${block.kind}${first ? ' is-first' : ''}${last ? ' is-last' : ''}`,
				attributes: { 'data-paraflow-rendered-line': String(line.number) } }).range(line.from));
			if (line.contentFrom < line.to) ranges.push(Decoration.mark({ class: 'paraflow-rendered-source-text' }).range(line.contentFrom, line.to));
		}
		if (block.fence) {
			ranges.push(Decoration.replace({ block: true, widget: new FenceWidget(block, true) }).range(block.from, block.fence.openingTo),
				Decoration.replace({ block: true, widget: new FenceWidget(block, false) }).range(block.fence.closingFrom, block.to));
		}
		if (block.lines.length) ranges.push(Decoration.widget({ widget: new BadgeWidget(block), side: -1 }).range(block.lines[0]!.contentFrom));
		if (block.kind === 'html') for (const token of htmlSourceTokens(state.sliceDoc(block.from, block.to))) {
			ranges.push(Decoration.mark({ class: `paraflow-html-${token.kind}` }).range(block.from + token.from, block.from + token.to));
		}
		if (block.kind === 'mermaid') ranges.push(Decoration.widget({ widget: new PreviewWidget(block, true, options, containerBlockFrame(state, block.from, block.to), previewRevision), block: true, side: 1 }).range(block.to));
	}
	return { previewRevision, enabled, focused, active, pressed, frozen, decorations: Decoration.set(ranges, true) };
}

export function createRenderedBlockEditing(options: RenderedBlockEditingOptions): Extension {
	const activate = StateEffect.define<boolean>(), focus = StateEffect.define<boolean>();
	const projection = StateField.define<Projection>({
		create: state => project(state, options, null, false, false),
		update: (value, transaction) => project(transaction.state, options, value,
			transaction.effects.find(effect => effect.is(activate))?.value ?? value.enabled,
			transaction.effects.find(effect => effect.is(focus))?.value ?? value.focused,
			value.previewRevision + Number(transaction.effects.some(effect => effect.is(refreshPreview)))),
		provide: field => Prec.highest(EditorView.decorations.from(field, value => value.decorations)),
	});
	const events = ViewPlugin.define(view => {
		let alive = true, queued = false, themeChanged = false, stylesheetChanged = false;
		let gesture: { from: number; x: number; y: number; dragged: boolean } | null = null;
		const sync = (): void => {
			if (queued) return; queued = true;
			queueMicrotask(() => {
				queued = false; if (!alive) return;
				if (owner !== view.dom.ownerDocument) {
					owner.defaultView!.removeEventListener('unload', unload); owner.removeEventListener('mousemove', move, true);
					contextObserver.disconnect(); owner = view.dom.ownerDocument; observeContext();
				}
				const value = view.state.field(projection), enabled = options.isActive(view) && options.isViewSupported(view);
				const contextChanged = refreshMermaidPreviews(view, themeChanged, stylesheetChanged); themeChanged = false; stylesheetChanged = false;
				if (value.enabled !== enabled || value.focused !== view.hasFocus || contextChanged) view.dispatch({ effects: [activate.of(enabled), focus.of(view.hasFocus), ...(contextChanged ? [refreshPreview.of(null)] : [])] });
			});
		};
		const targetBlock = (event: MouseEvent): { element: HTMLElement; from: number } | null => {
			const target = event.target as Element;
			if (target.closest('.cm-editor') !== view.dom) return null;
			const control = target.closest<HTMLElement>('.paraflow-rendered-block-badge');
			if (!control && target.closest(interactive)?.closest('.paraflow-rendered-block-preview')) return null;
			const element = control ?? target.closest<HTMLElement>('.paraflow-rendered-block-preview:not(.is-editing)');
			return element ? { element, from: Number(element.dataset.paraflowRenderedFrom) } : null;
		};
		const plain = (event: MouseEvent): boolean => event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.detail <= 1 && !view.composing;
		const down = (event: MouseEvent): void => {
			gesture = null;
			if (!plain(event) || !options.isActive(view)) return;
			const block = targetBlock(event); if (!block) return;
			gesture = { from: block.from, x: event.clientX, y: event.clientY, dragged: false };
			if (block.element.matches('button')) event.preventDefault();
		};
		const move = (event: MouseEvent): void => { if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 4) gesture.dragged = true; };
		const click = (event: MouseEvent): void => {
			move(event); const start = gesture; gesture = null;
			if (!start || start.dragged || !plain(event)) return;
			const hit = targetBlock(event); if (!hit || hit.from !== start.from) return;
			const block = discoverRenderedBlocks(view.state).find(item => item.from === start.from); if (!block) return;
			event.preventDefault(); event.stopImmediatePropagation();
			view.focus(); view.dispatch({ selection: { anchor: block.bodyFrom }, effects: focus.of(true), userEvent: 'select', scrollIntoView: true });
		};
		view.dom.addEventListener('mousedown', down, true); view.dom.addEventListener('click', click, true);
		let owner = view.dom.ownerDocument;
		const contextObserver = new owner.defaultView!.MutationObserver(records => {
			const changedStyles = mermaidThemeStylesChanged(records, owner);
			if (!changedStyles && !records.some(record => record.target === owner.body)) return;
			themeChanged = true;
			stylesheetChanged ||= changedStyles;
			sync();
		});
		const unload = (): void => { destroyMermaidPreviews(view); };
		const observeContext = (): void => {
			contextObserver.observe(owner.body, { attributes: true, attributeFilter: ['class', 'data-paraflow-theme', 'style'] });
			contextObserver.observe(owner.head, { childList: true, subtree: true, characterData: true, attributes: true });
			owner.defaultView!.addEventListener('unload', unload); owner.addEventListener('mousemove', move, true);
		};
		observeContext(); sync();
		return { update: sync, destroy() {
			alive = false; view.dom.removeEventListener('mousedown', down, true); view.dom.removeEventListener('click', click, true);
			owner.removeEventListener('mousemove', move, true);
			destroyMermaidPreviews(view);
			contextObserver.disconnect(); owner.defaultView!.removeEventListener('unload', unload);
		} };
	});
	const protectSelection = EditorState.transactionFilter.of(transaction => {
		if (!transaction.startState.field(projection).enabled || !options.isStateActive(transaction.startState)) return transaction;
		const selection = codeEditableSelection(transaction, boundaries(discoverRenderedBlocks(transaction.startState)), false);
		return selection ? [transaction, { selection, sequential: true }] : transaction;
	});
	const protectDelete = (view: EditorView, back: boolean): boolean => {
		if (!options.isActive(view) || view.composing || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false;
		const head = view.state.selection.main.head;
		for (const block of discoverRenderedBlocks(view.state)) {
			if (block.kind !== 'mermaid' || !block.fence) continue;
			const index = block.lines.findIndex(line => head === (back ? line.contentFrom : line.to));
			if (index < 0) continue;
			if (back && index === 0 || !back && index === block.lines.length - 1) return true;
			const previous = block.lines[back ? index - 1 : index]!, next = block.lines[back ? index : index + 1]!;
			// Join code rows through their container prefix as one ordinary newline
			// deletion; the remaining line keeps its original quote/list ownership.
			view.dispatch({ changes: { from: previous.to, to: next.contentFrom }, selection: { anchor: previous.to },
				userEvent: back ? 'delete.backward' : 'delete.forward' });
			return true;
		}
		return false;
	};
	return [projection, events, protectSelection,
		Prec.highest(keymap.of([
			...['Backspace', 'Mod-Backspace', 'Alt-Backspace'].map(key => ({ key, run: (view: EditorView) => protectDelete(view, true) })),
			...['Delete', 'Mod-Delete', 'Alt-Delete'].map(key => ({ key, run: (view: EditorView) => protectDelete(view, false) })),
		])),
		EditorView.focusChangeEffect.of((_state, focused) => focus.of(focused)),
		nativeBlockOwnership.of((state, view) => {
			if (!options.isViewSupported(view) || !options.isStateActive(state)) return null;
			const blocks = discoverRenderedBlocks(state);
			return (from, to, decoration) => {
				const spec = decoration.spec as { widget?: WidgetType & { html?: unknown; start?: unknown; end?: unknown }; block?: boolean };
				const widget = spec.widget;
				return blocks.some(block => {
					if (from >= block.from && to <= block.to && (isNativeReplacement(decoration) ||
						from === block.to && to === block.to && spec.block === true && Boolean(widget))) return true;
					// The host balances HTML through blank lines. Its preview may extend
					// beyond our grammar fragment, but still represents that same opener.
					return block.kind === 'html' && isNativeReplacement(decoration) && spec.block === true &&
						(from === block.from || from === block.bodyFrom) && to >= block.to && widget?.start === from && widget.end === to &&
						typeof widget.html === 'string' && widget.html.startsWith(block.source);
				});
			};
		}), createNativeDecorationOwnership()];
}
