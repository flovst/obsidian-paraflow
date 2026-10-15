import { EditorSelection, Prec, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { parser } from '@lezer/markdown';
import { discoverMath } from './math/syntax.js';
import type { PasteMode } from '../enhancement-settings.js';

const commandModes = new WeakMap<Event, PasteMode>();
const pasteTargets = new WeakMap<EditorView, { active: () => boolean; nested: boolean }>();
type ClipboardWindow = Window & { DataTransfer: typeof DataTransfer; File: typeof File; ClipboardEvent: typeof ClipboardEvent };

/** Complete a newly pasted fence without changing the clipboard or existing source. */
export function closePastedCodeFences(state: EditorState, text: string): string {
	const { from, to } = state.selection.main;
	const source = state.doc.toString();
	const original = parser.parse(source);
	let rawContext = false;
	original.iterate({ enter(node) {
		if (['FencedCode', 'CodeBlock', 'HTMLBlock'].includes(node.name) && node.from < from && from < node.to) rawContext = true;
	} });
	if (!rawContext && from === source.length) {
		// At EOF, ask the grammar whether a new line still belongs to the raw
		// block. A closed fence/comment and an unfinished one have different boundaries.
		parser.parse(source + '\nX').iterate({ enter(node) {
			if (['FencedCode', 'HTMLBlock'].includes(node.name) && node.from < from && node.to > from) rawContext = true;
		} });
	}
	if (rawContext || discoverMath(state).some(math => math.contentFrom <= from && to <= math.contentTo)) return text;
	// Parsing through the insertion boundary prevents borrowing an existing later
	// closing fence, which would silently absorb intervening document content.
	const prefix = source.slice(0, from) + text;
	const tree = parser.parse(prefix);
	let suffix = '';
	tree.iterate({ enter(ref) {
		if (ref.name !== 'FencedCode' || ref.to < prefix.trimEnd().length) return;
		const node = ref.node;
		const marks = node.getChildren('CodeMark');
		const opening = marks[0];
		if (!opening || marks.length !== 1 || opening.from < from) return;
		const lineFrom = prefix.lastIndexOf('\n', opening.from - 1) + 1;
		let indent = prefix.slice(lineFrom, opening.from);
		// List markers on the opening line become their content indentation;
		// blockquote markers remain part of the closing fence's container.
		for (let parent = node.parent; parent; parent = parent.parent) {
			if (parent.name !== 'ListItem' || parent.from < lineFrom) continue;
			const marker = parent.getChild('ListMark');
			if (!marker || marker.to > opening.from) continue;
			const a = marker.from - lineFrom, b = marker.to - lineFrom;
			indent = indent.slice(0, a) + ' '.repeat(b - a) + indent.slice(b);
		}
		const newline = text.includes('\r\n') ? '\r\n' : '\n';
		suffix = (text.endsWith('\n') ? '' : newline) + indent + prefix.slice(opening.from, opening.to) + newline;
	} });
	return text + suffix;
}

export function createClipboardPasteExtension(options: {
	isActive: (view: EditorView) => boolean;
	enabled: () => boolean;
	getMode: (view: EditorView) => PasteMode;
	notify: (message: string) => void;
}): Extension {
	return Prec.highest(ViewPlugin.fromClass(class {
		rawPaste = false;
		readonly target: { active: () => boolean; nested: boolean };
		constructor(readonly view: EditorView) {
			const focused = view.dom.ownerDocument.activeElement;
			const nested = view.dom.contains(focused) ? !ownsPasteTarget(view, focused) : pasteTargets.get(view)?.nested ?? false;
			this.target = { active: () => options.isActive(view), nested };
			pasteTargets.set(view, this.target);
			view.contentDOM.addEventListener('paste', this.paste, true);
			view.dom.addEventListener('focusin', this.focus, true);
		}
		destroy() {
			this.target.active = () => false;
			this.view.contentDOM.removeEventListener('paste', this.paste, true);
			this.view.dom.removeEventListener('focusin', this.focus, true);
			// Keep weakly held focus intent for same-view reconfiguration; this lifetime is inactive.
		}
		focus = (event: FocusEvent) => { this.target.nested = !ownsPasteTarget(this.view, event.target); };
		paste = (event: ClipboardEvent) => {
			const view = this.view;
			const raw = this.rawPaste;
			this.rawPaste = false;
			if (!options.isActive(view) || view.state.readOnly || view.composing || !ownsPasteTarget(view, event.target)) return;
			const mode = commandModes.get(event) ?? (raw ? 'exact' : options.getMode(view));
			const data = event.clipboardData;
			if (mode === 'exact') {
				event.preventDefault();
				event.stopImmediatePropagation();
				const type = ['text/plain', 'text/markdown', 'text/html'].find(type => data?.types.includes(type));
				if (!data || !type) {
					options.notify('剪贴板中没有可精确粘贴的文本。请使用“本次智能粘贴”粘贴图片、文件或富文本。');
					return;
				}
				const text = view.state.toText(data.getData(type));
				let index = 1;
				const changes = text.lines === view.state.selection.ranges.length
					? view.state.changeByRange(range => {
						const line = text.line(index++);
						return { changes: { from: range.from, to: range.to, insert: line.text }, range: EditorSelection.cursor(range.from + line.length) };
					}) : view.state.replaceSelection(text);
				// Exact input bypasses all transaction/change and clipboard text filters.
				view.dispatch(view.state.update({ ...changes, filter: false, userEvent: 'input.paste', scrollIntoView: true }));
				return;
			}
			if (!options.enabled() || view.state.selection.ranges.length !== 1 || !data || data.files.length || !data.types.includes('text/plain')) return;
			const text = data.getData('text/plain');
			const adjusted = closePastedCodeFences(view.state, text);
			if (adjusted === text) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			view.dispatch(view.state.replaceSelection(adjusted), { userEvent: 'input.paste', scrollIntoView: true });
		};
		update(update: ViewUpdate) {
			if (update.docChanged || update.selectionSet) this.rawPaste = false;
		}
	}, { eventHandlers: {
		keydown(event, view) {
			this.rawPaste = options.isActive(view) && (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v';
			return false;
		},
		// Electron can deliver paste after all keyup events. Keep the intent until
		// paste consumes it, or another interaction changes its target.
		pointerdown() { this.rawPaste = false; return false; },
		blur() { this.rawPaste = false; return false; },
	} }));
}

function ownsPasteTarget(view: EditorView, target: EventTarget | null): boolean {
	return target instanceof Element && target.closest('.cm-content, input, textarea, select, button, [contenteditable]') === view.contentDOM;
}

/** Read the browser's multi-MIME clipboard without rewriting the system clipboard. */
export async function readClipboardData(view: EditorView): Promise<DataTransfer> {
	const win = view.dom.ownerDocument.defaultView as ClipboardWindow;
	const clipboard = win.navigator.clipboard as Clipboard & { read(options: { unsanitized: string[] }): Promise<ClipboardItems> };
	if (!clipboard?.read) throw new Error('此环境不支持读取剪贴板。请使用键盘粘贴。');
	const items = await clipboard.read({ unsanitized: ['text/html'] });
	const data = new win.DataTransfer();
	for (const item of items) {
		for (const type of item.types) {
			const blob = await item.getType(type);
			if (type.startsWith('text/')) {
				if (!data.types.includes(type)) data.setData(type, await blob.text());
			} else {
				const extension = type === 'image/png' ? '.png' : type === 'image/jpeg' ? '.jpg' : '';
				data.items.add(new win.File([blob], `clipboard${extension}`, { type }));
			}
		}
	}
	return data;
}

/** A one-shot command owns only the view and selection that started its read. */
export async function pasteFromClipboard(view: EditorView, mode: PasteMode, options: {
	getView: () => EditorView | null;
	notify: (message: string) => void;
	read?: (view: EditorView) => Promise<DataTransfer>;
}): Promise<void> {
	const target = pasteTargets.get(view);
	if (!target?.active() || view.state.readOnly || view.composing || options.getView() !== view) return;
	if (target.nested) {
		options.notify('当前在嵌套编辑区域内。请切换到源码模式（Source）后使用本次粘贴命令。');
		return;
	}
	view.focus();
	const state = view.state;
	let lostFocus = false;
	const onBlur = () => { lostFocus = true; };
	view.contentDOM.addEventListener('blur', onBlur);
	try {
		const data = await (options.read ?? readClipboardData)(view);
		if (lostFocus || !view.dom.isConnected || !view.hasFocus || view.state !== state || !target.active() || options.getView() !== view || view.composing || pasteTargets.get(view) !== target) {
			options.notify('粘贴已取消：读取剪贴板期间编辑目标或选区发生了变化。请重新粘贴。');
			return;
		}
		const win = view.dom.ownerDocument.defaultView as ClipboardWindow;
		const event = new win.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
		commandModes.set(event, mode);
		view.contentDOM.dispatchEvent(event);
	} catch (error) {
		options.notify(`无法读取剪贴板：${String(error)}。请使用键盘粘贴。`);
	} finally {
		view.contentDOM.removeEventListener('blur', onBlur);
	}
}
