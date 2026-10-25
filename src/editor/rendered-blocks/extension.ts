import { containerBlockFrame, wrapContainerBlock, type ContainerFrame } from '../callout/container-surface.js';
import { isolateHistory } from '@codemirror/commands';
import { EditorState, Prec, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { createNativeDecorationOwnership, isNativeReplacement, nativeBlockOwnership, restoreNativeSourceLines } from '../runtime/native-decoration-ownership.js';
import { selectionPointerPressed } from '../runtime/selection-session.js';
import { codeEditableSelection } from '../code-blocks/editable-boundaries.js';
import { openCodeLanguagePopup, type CodeLanguagePopup } from '../code-blocks/language-popup.js';
import type { CodeBlock } from '../code-blocks/source-scan.js';
import { discoverRenderedBlocks, htmlSourceTokens, type RenderedBlock } from './model.js';
import { destroyMermaidPreviews, mermaidThemeStylesChanged, mountMermaidPreview, refreshMermaidPreviews } from './mermaid-preview.js';
export { renderedBlockEditorStyles } from './styles.js';
export interface RenderedBlockEditingOptions {
	isStateActive: (state: EditorState) => boolean;
	isKindEnabled?: (kind: RenderedBlock['kind']) => boolean;
	isActive: (view: EditorView) => boolean;
	isViewSupported: (view: EditorView) => boolean;
	sourcePath?: (view: EditorView) => string;
	subscribeMarkdownChanges?: (listener: () => void) => () => void;
	getCodeLanguagePosition?: () => 'off' | 'top-right' | 'bottom-right';
	renderMarkdown: (source: string, target: HTMLElement, view: EditorView, kind: 'html' | 'mermaid') => { ready: Promise<void>; destroy(): void };
}
const interactive = 'summary,a,button,input,textarea,select,audio,video,[contenteditable="true"],[role="button"]';
const cleanup = new WeakMap<HTMLElement, () => void>();
const previewWidgets = new WeakMap<HTMLElement, PreviewWidget>();
const mermaidCurrent = new WeakMap<HTMLElement, () => boolean>();
const refreshPreview = StateEffect.define<null>();
function enabledBlocks(state: EditorState, options: RenderedBlockEditingOptions): RenderedBlock[] {
	return discoverRenderedBlocks(state).filter(block => options.isKindEnabled?.(block.kind) ?? true);
}
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
	readonly languagePosition: 'off' | 'top-right' | 'bottom-right';
	constructor(readonly block: RenderedBlock, readonly editing: boolean, readonly options: RenderedBlockEditingOptions, readonly frame: ContainerFrame | null,
		readonly revision: number) { super(); this.languagePosition = options.getCodeLanguagePosition?.() ?? 'bottom-right'; }
	eq(other: PreviewWidget): boolean {
		return this.revision === other.revision && this.sameContent(other);
	}
	private sameContent(other: PreviewWidget): boolean {
		return this.languagePosition === other.languagePosition && this.block.from === other.block.from && this.block.source === other.block.source && this.block.kind === other.block.kind && this.editing === other.editing && this.options === other.options && this.frame?.key === other.frame?.key;
	}
	toDOM(view: EditorView): HTMLElement {
		const owner = view.dom.ownerDocument;
		const element = owner.createElement('div');
		element.className = `paraflow-rendered-block-preview paraflow-rendered-block-${this.block.kind}` + (this.editing ? ' is-editing' : '');
		element.dataset.paraflowRenderedFrom = String(this.block.from);
		element.setAttribute('contenteditable', 'false');
		if (!this.editing) element.append(badge(view, this.block));
		const content = owner.createElement('div'); content.className = 'paraflow-rendered-block-content markdown-rendered'; element.append(content);
		if (this.editing && this.block.kind === 'mermaid' && this.languagePosition !== 'off') {
			const language = owner.createElement('div'); language.className = 'paraflow-rendered-language-anchor';
			language.dataset.position = this.languagePosition;
			language.setAttribute('aria-hidden', 'true');
			language.dataset.paraflowRenderedFrom = String(this.block.from); element.append(language);
		}
		this.render(element, view);
		return wrapContainerBlock(view, element, this.frame);
	}
	updateDOM(root: HTMLElement, view: EditorView): boolean {
		if (root.dataset.paraflowContainerFrame !== this.frame?.key) return false;
		const element = root.classList.contains('paraflow-container-block') ? root.lastElementChild as HTMLElement : root;
		if (previewWidgets.get(element)?.languagePosition !== this.languagePosition) return false;
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
	outputs: readonly BlockOutput[];
}
interface BlockOutput {
	block: RenderedBlock; active: boolean; frameKey: string | undefined; revision: number; ranges: readonly Range<Decoration>[];
	languagePosition: 'off' | 'top-right' | 'bottom-right';
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
	if (!enabled || !options.isStateActive(state)) return { previewRevision, enabled, focused, active: null, pressed, frozen: null, decorations: Decoration.none, outputs: [] };
	const blocks = enabledBlocks(state, options), selection = state.selection.main;
	const caret = selection.empty ? blocks.find(block => block.from <= selection.head && selection.head <= block.to) ?? null : null;
	const old = same(blocks, previous?.active ?? null);
	const selected = old && state.selection.ranges.some(range => !range.empty && range.from < old.to && range.to > old.from) ? old : null;
	const active = !focused ? null : pressed ? same(blocks, frozen) : selected ?? caret;
	const outputs: BlockOutput[] = [];
	const languagePosition = options.getCodeLanguagePosition?.() ?? 'bottom-right';
	for (const [index, block] of blocks.entries()) {
		const frame = containerBlockFrame(state, block.from, block.to), was = previous?.outputs[index];
		if (was?.block === block && was.active === (block === active) && was.frameKey === frame?.key && was.revision === previewRevision && was.languagePosition === languagePosition) {
			outputs.push(was); continue;
		}
		const ranges: Range<Decoration>[] = [];
		outputs.push({ block, active: block === active, frameKey: frame?.key, revision: previewRevision, ranges, languagePosition });
		if (block !== active) {
			ranges.push(Decoration.replace({ widget: new PreviewWidget(block, false, options, frame, previewRevision), block: true, inclusiveEnd: true }).range(block.from, block.to));
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
		if (block.kind === 'mermaid') ranges.push(Decoration.widget({ widget: new PreviewWidget(block, true, options, frame, previewRevision), block: true, side: 1 }).range(block.to));
	}
	const decorations = previous && outputs.length === previous.outputs.length && outputs.every((output, index) => output === previous.outputs[index])
		? previous.decorations : Decoration.set(outputs.flatMap(output => output.ranges), true);
	return { previewRevision, enabled, focused, active, pressed, frozen, decorations, outputs };
}

/** Source-ordered, disjoint owners; the predecessor can also own a zero-width shared edge. */
function ownershipCandidates(blocks: readonly RenderedBlock[], from: number): readonly RenderedBlock[] {
	let low = 0, high = blocks.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (blocks[middle]!.from <= from) low = middle + 1;
		else high = middle;
	}
	return blocks.slice(Math.max(0, low - 2), low);
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
		let alive = true, queued = false, themeChanged = false, stylesheetChanged = false, markdownChanged = false;
		let languagePopup: CodeLanguagePopup | null = null;
		let languageAnchor: HTMLElement | null = null;
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
				if (markdownChanged) destroyMermaidPreviews(view);
				const contextChanged = refreshMermaidPreviews(view, themeChanged, stylesheetChanged) || markdownChanged;
				themeChanged = false; stylesheetChanged = false; markdownChanged = false;
				const focused = view.hasFocus || !!languagePopup?.containsFocus();
				if (!enabled) languagePopup?.close();
				if (value.enabled !== enabled || value.focused !== focused || contextChanged) view.dispatch({ effects: [activate.of(enabled), focus.of(focused), ...(contextChanged ? [refreshPreview.of(null)] : [])] });
				const current = view.state.field(projection), block = current.active;
				const position = options.getCodeLanguagePosition?.() ?? 'bottom-right';
				const anchor = block?.kind === 'mermaid' && position !== 'off'
					? view.contentDOM.querySelector<HTMLElement>(`.paraflow-rendered-language-anchor[data-paraflow-rendered-from="${block.from}"]`) : null;
				if (languagePopup && anchor !== languageAnchor) languagePopup.close();
				if (!anchor || languagePopup) return;
				languageAnchor = anchor;
				languagePopup = openCodeLanguagePopup(view, block!.from, anchor, { position: position as 'top-right' | 'bottom-right', focus: false, dismissOnPointerLeave: false,
					onClose: () => { languagePopup = null; languageAnchor = null; sync(); } });
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
			const block = enabledBlocks(view.state, options).find(item => item.from === start.from); if (!block) return;
			event.preventDefault(); event.stopImmediatePropagation();
			view.focus(); view.dispatch({ selection: { anchor: block.bodyFrom }, effects: focus.of(true), userEvent: 'select', scrollIntoView: true });
		};
		view.dom.addEventListener('mousedown', down, true); view.dom.addEventListener('click', click, true);
		view.dom.addEventListener('focusout', sync);
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
		const unsubscribeMarkdownChanges = options.subscribeMarkdownChanges?.(() => { markdownChanged = true; sync(); });
		observeContext(); sync();
		return { update(update) {
			if (update.startState.field(projection).outputs.length && !options.isStateActive(update.state)) restoreNativeSourceLines(view);
			if (update.docChanged) languagePopup?.close();
			sync();
		}, destroy() {
			alive = false; view.dom.removeEventListener('mousedown', down, true); view.dom.removeEventListener('click', click, true);
			languagePopup?.close(); view.dom.removeEventListener('focusout', sync);
			unsubscribeMarkdownChanges?.();
			owner.removeEventListener('mousemove', move, true);
			destroyMermaidPreviews(view);
			contextObserver.disconnect(); owner.defaultView!.removeEventListener('unload', unload);
		} };
	});
	const protectSelection = EditorState.transactionFilter.of(transaction => {
		if (!transaction.startState.field(projection).enabled || !options.isStateActive(transaction.startState)) return transaction;
		const selection = codeEditableSelection(transaction, boundaries(enabledBlocks(transaction.startState, options)), false);
		return selection ? [transaction, { selection, sequential: true }] : transaction;
	});
	const protectDelete = (view: EditorView, back: boolean): boolean => {
		if (!options.isActive(view) || view.state.readOnly || view.composing || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false;
		const head = view.state.selection.main.head;
		for (const block of enabledBlocks(view.state, options)) {
			if (block.kind !== 'mermaid' || !block.fence) continue;
			const first = block.lines[0];
			const atEmptyBody = first ? first.contentFrom <= head && head <= first.to &&
				block.lines.every(line => /^[ \t]*$/u.test(view.state.sliceDoc(line.contentFrom, line.to))) : head === block.bodyFrom;
			if (back && atEmptyBody) {
				const prefix = block.fence.continuation;
				view.dispatch({ changes: { from: block.from, to: block.to, insert: prefix },
					selection: { anchor: block.from + prefix.length }, userEvent: 'delete.code-block', annotations: isolateHistory.of('full') });
				return true;
			}
			if (!first && head === block.bodyFrom) return true;
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
		EditorView.focusChangeEffect.of((_state, focused) => focused ? focus.of(true) : null),
		nativeBlockOwnership.of((state, view) => {
			if (!options.isViewSupported(view) || !options.isStateActive(state)) return null;
			const blocks = enabledBlocks(state, options);
			return (from, to, decoration) => {
				const spec = decoration.spec as { widget?: WidgetType & { html?: unknown; start?: unknown; end?: unknown }; block?: boolean };
				const widget = spec.widget;
				const replacement = isNativeReplacement(decoration);
				if (!replacement && !(from === to && spec.block === true && widget)) return false;
				return ownershipCandidates(blocks, from).some(block => {
					if (from >= block.from && to <= block.to && (replacement ||
						from === block.to && to === block.to && spec.block === true && Boolean(widget))) return true;
					// The host balances HTML through blank lines. Its preview may extend
					// beyond our grammar fragment, but still represents that same opener.
					return block.kind === 'html' && replacement && spec.block === true &&
						(from === block.from || from === block.bodyFrom) && to >= block.to && widget?.start === from && widget.end === to &&
						typeof widget.html === 'string' && widget.html.startsWith(block.source);
				});
			};
		}), createNativeDecorationOwnership()];
}
