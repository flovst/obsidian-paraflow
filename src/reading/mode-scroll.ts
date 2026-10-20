import { EditorView } from '@codemirror/view';
import { discoverParagraphAuthority } from '../editor/paragraph/syntax.js';
import { restoreSourceBlock } from './source-scroll.js';

interface ReadingSection { element: HTMLElement; path: string; from: number; to: number; source: string; }
interface NativeReadingSection { el: HTMLElement; lines: number; height: number; computed: boolean; shown: boolean; }
interface ReadingRenderer {
	set(text: string): void;
	onResize(): void;
	applyScroll(line: number, options?: unknown): boolean;
	onRendered(callback: () => void): void;
	text: string; lastText: string; scrolling: boolean; topSpace: number;
	sections: NativeReadingSection[];
	asyncSections: NativeReadingSection[];
	header: NativeReadingSection;
	pusherEl: HTMLElement;
	previewEl: HTMLElement;
	getSectionTop(section: NativeReadingSection): number;
	measureSection(section: NativeReadingSection): void;
	queueRender(): void;
	updateVirtualDisplay(target?: number): void;
}
interface ModeState { file?: string; mode?: string; source?: boolean; }
export interface ModeScrollView {
	containerEl: HTMLElement;
	file: { path: string } | null;
	editor: unknown;
	editMode: { applyScroll(line: number): void; isScrolling: boolean };
	previewMode: { containerEl: HTMLElement; renderer: ReadingRenderer };
	getMode(): string;
	syncScroll(): void;
	getState(): ModeState;
	setState(state: ModeState, result: unknown): Promise<void>;
}
interface Anchor {
	line: number;
	top: boolean;
	offset(line: number): number | undefined;
	valid(): boolean;
}

/** LP and Reading share block geometry, not the host's average pixels per source line. */
export function createModeScrollAlignment() {
	const sections = new Map<HTMLElement, ReadingSection>();
	const bindings = new Map<ModeScrollView, { destroy(): void }>();
	let disposed = false;
	const editor = (view: ModeScrollView) => (view.editor as { cm: EditorView }).cm;
	function readingSections(view: ModeScrollView): ReadingSection[] {
		const source = editor(view).state.doc.toString();
		return [...sections.values()].filter(section => section.source === source && section.path === view.file?.path &&
			view.previewMode.containerEl.contains(section.element) && section.element.isConnected &&
			section.element.parentElement?.matches('.markdown-preview-sizer') && section.element.closest('.markdown-reading-view'))
			.sort((a, b) => a.from - b.from);
	}
	function capture(view: ModeScrollView): Anchor | null {
		const cm = editor(view), doc = cm.state.doc;
		if (view.getMode() === 'source') {
			const scroll = cm.scrollDOM.scrollTop;
			const origin = cm.documentTop + scroll - cm.scrollDOM.getBoundingClientRect().top;
			const block = cm.lineBlockAtHeight(Math.max(0, scroll - origin));
			// Capture while the editor is visible; hiding it may rebuild its height map.
			const starts = new Set([block.from, ...discoverParagraphAuthority(cm.state).blocks.map(block => block.from),
				...readingSections(view).map(section => doc.line(section.from + 1).from)]);
			const offsets = new Map([...starts].map(from => [doc.lineAt(from).number - 1, origin + cm.lineBlockAt(from).top - scroll]));
			return { line: doc.lineAt(block.from).number - 1, top: scroll === 0,
				offset: line => offsets.get(line),
				valid: () => cm.state.doc.eq(doc) };
		}
		const scroll = view.previewMode.containerEl.querySelector<HTMLElement>('.markdown-preview-view')!;
		const viewport = scroll.getBoundingClientRect().top;
		const candidates = readingSections(view);
		const section = candidates.find(candidate => candidate.element.getBoundingClientRect().bottom > viewport) ?? candidates.at(-1);
		if (!section) return null;
		const offset = body(section.element).getBoundingClientRect().top - viewport;
		return { line: section.from, top: scroll.scrollTop === 0, offset: () => offset, valid: () => cm.state.doc.eq(doc) };
	}
	function body(section: HTMLElement): HTMLElement {
		return section.firstElementChild as HTMLElement ?? section;
	}

	function bind(view: ModeScrollView): { destroy(): void } {
		const original = view.setState.bind(view), own = Object.getOwnPropertyDescriptor(view, 'setState');
		const source = view.editMode, reading = view.previewMode.renderer;
		const sourceApply = source.applyScroll.bind(source), readingApply = reading.applyScroll.bind(reading);
		const sourceOwn = Object.getOwnPropertyDescriptor(source, 'applyScroll'), readingOwn = Object.getOwnPropertyDescriptor(reading, 'applyScroll');
		const measure = reading.measureSection.bind(reading), measureOwn = Object.getOwnPropertyDescriptor(reading, 'measureSection');
		const bodyOffsets = new WeakMap<NativeReadingSection, number>();
		let preparation: { cancel(): void; check(): void } | null = null;
		const remember = (section: NativeReadingSection): void => {
			const bounds = section.el.getBoundingClientRect();
			if (section.computed && section.el.isConnected && bounds.height > 0) bodyOffsets.set(section,
				body(section.el).getBoundingClientRect().top - bounds.top);
		};
		const measureSection = function(this: ReadingRenderer, section: NativeReadingSection): void {
			// Native measurement mounts sections before virtualization can detach them.
			measure(section); remember(section); preparation?.check();
		};
		reading.measureSection = measureSection;
		let needsMeasurement = false;
		for (const section of reading.sections) {
			remember(section);
			// One-time initialization for geometry cached before this view was bound.
			if (section.lines > 0 && section.computed && !bodyOffsets.has(section)) { section.computed = false; needsMeasurement = true; }
		}
		if (needsMeasurement) reading.queueRender();
		let current: { anchor: Anchor; path: string; target: string; restored: boolean; cancelled?: boolean; input?: number } | null = null;
		let alive = true;
		const stop = () => { preparation?.cancel(); current = null; };
		const cancel = () => { preparation?.cancel(); if (current) current.cancelled = true; };
		for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) view.containerEl.addEventListener(type, cancel, true);
		const transition = (target: string, input: number) => {
			const value = current;
			if (!value) return null;
			if (disposed || !alive || value.target !== target || view.getMode() !== target ||
				value.input !== undefined && value.input !== input) { stop(); return null; }
			value.input = input;
			if (view.file?.path !== value.path || !value.anchor.valid()) value.cancelled = true;
			return value;
		};
		const restoreSource = function(this: typeof source, input: number): void {
			const value = transition('source', input);
			if (!value) { sourceApply.call(this, input); return; }
			if (value.restored || value.cancelled) return;
			const cm = editor(view), offset = value.anchor.offset(value.anchor.line)!;
			this.isScrolling = true;
			value.restored = true;
			// CM owns viewport measurement and the first scroll, including off-screen blocks.
			if (value.anchor.top) { cm.scrollDOM.scrollTop = 0; view.syncScroll(); }
			else {
				const from = cm.state.doc.line(value.anchor.line + 1).from;
				const valid = () => current === value && !value.cancelled && value.anchor.valid();
				cm.dispatch({ effects: [restoreSourceBlock.of({ from, offset, valid,
					// Host logical-scroll bookkeeping reads layout outside CM's write phase.
					restored: () => view.containerEl.ownerDocument.defaultView!.queueMicrotask(() => { if (valid()) view.syncScroll(); }),
				}), EditorView.scrollIntoView(from, { y: 'start' })] });
			}
		};
		const restoreReading = function(this: typeof reading, input: number, options?: unknown): boolean {
			if (options) { stop(); return readingApply.call(this, input, options); }
			const value = transition('preview', input);
			if (!value) return readingApply.call(this, input);
			if (value.restored || value.cancelled) return true;
			if (this.text !== this.lastText) return false;
			// show() transfers the shared title/metadata only when the mode commits.
			this.measureSection(this.header);
			this.topSpace = this.pusherEl.offsetTop;
			let line = 0;
			const native = this.sections.find(section => {
				if (line + section.lines > value.anchor.line) return true;
				line += section.lines; return false;
			});
			if (!native || this.sections.slice(0, this.sections.indexOf(native) + 1).some(section => !section.computed)) return false;
			const section = sections.get(native.el);
			if (!section || section.path !== value.path || section.source !== this.text) return false;
			const offset = value.anchor.offset(section.from);
			if (offset === undefined) throw new Error('Reading restore section has no captured source block');
			const bodyOffset = bodyOffsets.get(native);
			if (bodyOffset === undefined) throw new Error('Computed Reading section has no measured body offset');
			this.scrolling = true;
			value.restored = true;
			const target = value.anchor.top ? 0 : Math.max(0, this.topSpace + this.getSectionTop(native) + bodyOffset - offset);
			this.updateVirtualDisplay(target);
			view.syncScroll();
			return true;
		};
		const wrapper = async function(this: ModeScrollView, state: ModeState, result: unknown): Promise<void> {
			stop();
			const document = this.containerEl.ownerDocument, focused = document.activeElement;
			const sourceFocused = editor(this).hasFocus;
			const path = this.file?.path, from = this.getMode(), target = state.mode;
			const eligible = !disposed && alive && path && (!state.file || state.file === path) && target !== from &&
				(from === 'preview' || from === 'source') && (target === 'preview' || target === 'source') &&
				this.getState().source !== true && state.source !== true;
			const anchor = eligible ? capture(this) : null;
			if (anchor) current = { anchor, path: path!, target: target!, restored: false };
			if (anchor && target === 'preview' && (reading.text !== editor(this).state.doc.toString() || reading.text !== reading.lastText || reading.asyncSections.length || reading.sections.some(section => !section.computed))) {
				const value = current;
				const container = this.previewMode.containerEl, parent = container.parentElement!;
				const positioned = container.ownerDocument.defaultView!.getComputedStyle(parent).position === 'static';
				if (positioned) parent.classList.add('paraflow-mode-stage-host');
				container.classList.add('paraflow-mode-stage');
				let resolve!: (ready: boolean) => void;
				const ready = new Promise<boolean>(done => { resolve = done; });
				let cleaned = false, scheduled = false;
				const cleanup = () => {
					if (cleaned) return; cleaned = true;
					container.classList.remove('paraflow-mode-stage');
					if (positioned) parent.classList.remove('paraflow-mode-stage-host');
				};
				const check = () => {
					if (scheduled) return; scheduled = true;
					container.ownerDocument.defaultView!.queueMicrotask(() => {
						scheduled = false;
						if (cleaned || reading.text !== reading.lastText) return;
						let line = 0, height = 0, required: number | null = null;
						for (const native of reading.sections) {
							if (!native.computed || reading.asyncSections.includes(native)) return;
							if (line <= anchor.line && line + native.lines > anchor.line) {
								const section = sections.get(native.el), bodyOffset = bodyOffsets.get(native);
								const offset = section && anchor.offset(section.from);
								if (offset === undefined || bodyOffset === undefined) return;
								required = height + bodyOffset - offset + container.clientHeight;
							}
							line += native.lines; if (native.shown) height += native.height;
							if (required !== null && height >= required) { resolve(true); return; }
						}
						if (required !== null) resolve(true);
					});
				};
				const pending = { cancel: () => { cleanup(); resolve(false); }, check }; preparation = pending;
				try {
					// Existing source remains the current mode until the real target has layout.
					// Initialize the native width owner before it measures prepared sections.
					reading.onResize();
					reading.set(editor(this).state.doc.toString());
					reading.onRendered(() => resolve(true));
					if (!await ready || current !== value || value?.cancelled || !anchor.valid() || this.file?.path !== path) return;
				} finally {
					if (preparation === pending) preparation = null;
					cleanup();
				}
			}
			try {
				await original.call(this, state, result);
				if (anchor && sourceFocused && target === 'preview' && this.getMode() === target &&
					(document.activeElement === focused || document.activeElement === document.body)) {
					reading.previewEl.tabIndex = -1; reading.previewEl.focus({ preventScroll: true });
				}
			}
			catch (error) { stop(); throw error; }
		};
		view.setState = wrapper; source.applyScroll = restoreSource; reading.applyScroll = restoreReading;
		return { destroy() {
			alive = false; stop();
			for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) view.containerEl.removeEventListener(type, cancel, true);
			if (view.setState === wrapper) { if (own) Object.defineProperty(view, 'setState', own); else delete (view as Partial<ModeScrollView>).setState; }
			if (source.applyScroll === restoreSource) { if (sourceOwn) Object.defineProperty(source, 'applyScroll', sourceOwn); else delete (source as Partial<typeof source>).applyScroll; }
			if (reading.applyScroll === restoreReading) { if (readingOwn) Object.defineProperty(reading, 'applyScroll', readingOwn); else delete (reading as Partial<typeof reading>).applyScroll; }
			if (reading.measureSection === measureSection) { if (measureOwn) Object.defineProperty(reading, 'measureSection', measureOwn); else delete (reading as Partial<typeof reading>).measureSection; }
		} };
	}
	return {
		syncViews(views: readonly ModeScrollView[]): void {
			if (disposed) return;
			const live = new Set(views);
			for (const [view, binding] of bindings) if (!live.has(view)) { binding.destroy(); bindings.delete(view); }
			for (const view of views) if (!bindings.has(view)) bindings.set(view, bind(view));
		},
		register(element: HTMLElement, path: string, from: number, to: number, source: string): () => void {
			if (disposed) return () => {};
			// Native render children can load before insertion. Check Reading ownership when consuming the section.
			const section = { element, path, from, to, source }; sections.set(element, section);
			return () => { if (sections.get(element) === section) sections.delete(element); };
		},
		destroy(): void {
			disposed = true;
			for (const binding of bindings.values()) binding.destroy();
			bindings.clear(); sections.clear();
		},
	};
}
