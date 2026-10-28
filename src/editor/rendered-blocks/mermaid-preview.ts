import { createDetachedEl } from '../../dom';
import type { EditorView } from '@codemirror/view';
import type { RenderedBlockEditingOptions } from './extension.js';
import { hasMermaidContentTheme, mermaidMarkdownTheme } from '../../display/mermaid-theme.js';

interface MermaidHost {
	mermaidAPI?: { getConfig(): unknown };
}
interface Entry {
	source: string;
	from: number;
	content: HTMLElement;
	state: 'loading' | 'ready' | 'error';
	destroy(): void;
	observer: MutationObserver;
	lease: { changed(): void } | null;
}
const idleLimit = 8;
const pools = new WeakMap<EditorView, MermaidPreviews>();
interface Lease { content: HTMLElement; state: () => Entry['state']; current: () => boolean; release: (discard?: boolean) => void }
interface Mount { lease: Lease; previous: Lease | null; stop(): void }
const mounts = new WeakMap<HTMLElement, Mount>();

export function mermaidThemeStylesChanged(records: readonly MutationRecord[], owner: Document): boolean {
	const themeStyle = (node: Node): boolean => {
		if (node.nodeName === 'LINK') return true;
		if (node.nodeName !== 'STYLE') return false;
		// style-mod rewrites this generated editor sheet on Source/LP changes.
		// Its generated class prefix identifies editor presentation, not a theme.
		return !/^\s*\.ͼ[\da-z]+[\s.#:{]/i.test(node.firstChild?.textContent?.slice(0, 80) ?? '');
	};
	return records.some(record => owner.head.contains(record.target) &&
		(themeStyle(record.target) || record.target.nodeType === 3 && Boolean(record.target.parentNode && themeStyle(record.target.parentNode)) ||
			[...record.addedNodes, ...record.removedNodes].some(themeStyle)));
}

// Keep the native target itself: Mermaid may replace code.parentElement after
// MarkdownRenderer.ready, and the loaded Component owns its link handlers.
export class MermaidPreviews {
	private entries: Entry[] = [];
	private context: string;
	private document: Document;
	private host: MermaidHost | undefined;
	private sourcePath: string;
	private renderer: RenderedBlockEditingOptions['renderMarkdown'];
	private alive = true;
	private invalidated = false;
	private stylesheetRevision = 0;
	private readonly functions = new WeakMap<object, number>();
	private nextFunction = 0;
	constructor(private view: EditorView, private options: RenderedBlockEditingOptions) {
		this.document = view.dom.ownerDocument;
		this.host = this.engine();
		this.sourcePath = options.sourcePath?.(view) ?? '';
		this.renderer = options.renderMarkdown;
		this.context = this.readContext();
	}
	private engine(): MermaidHost | undefined {
		return (this.document.defaultView as (Window & { mermaid?: MermaidHost }) | null)?.mermaid;
	}
	private readContext(): string {
		const body = this.document.body;
		return JSON.stringify([
			this.sourcePath,
			body.classList.contains('theme-dark'), body.getAttribute('data-paraflow-theme'),
			this.stylesheetRevision,
			this.document.defaultView!.getComputedStyle(body).getPropertyValue('--font-mermaid'),
			this.host?.mermaidAPI?.getConfig(),
		], (_key, value: unknown) => {
			if (typeof value !== 'function') return value;
			let id = this.functions.get(value);
			if (id === undefined) { id = ++this.nextFunction; this.functions.set(value, id); }
			return `function:${id}`;
		});
	}
	refreshContext(checkConfiguration = false, themeChanged = false): boolean {
		const previousDocument = this.document, previousHost = this.host;
		this.document = this.view.dom.ownerDocument;
		this.host = this.engine();
		const path = this.options.sourcePath?.(this.view) ?? '';
		const ownerChanged = previousDocument !== this.document || this.renderer !== this.options.renderMarkdown || path !== this.sourcePath;
		if (!checkConfiguration && !themeChanged && !ownerChanged && previousHost === this.host) return false;
		this.sourcePath = path; this.renderer = this.options.renderMarkdown;
		const next = this.readContext();
		// The first render can lazily load Mermaid. Its resulting config belongs to
		// that same generation, rather than requiring a second conversion.
		const initialLoad = !previousHost && this.host && !ownerChanged && !themeChanged;
		const changed = !initialLoad && (ownerChanged || previousHost !== this.host || next !== this.context);
		this.context = next;
		if (changed) for (const entry of [...this.entries]) this.dispose(entry);
		return changed;
	}
	acquire(source: string, from: number, changed: () => void): Lease {
		if (this.refreshContext(true)) this.invalidated = true;
		let entry = this.entries.find(item => item.source === source && item.state !== 'error' && !item.lease);
		entry ??= this.entries.find(item => item.source === source && item.state !== 'error' && item.from === from);
		if (!entry) entry = this.create(source, from);
		entry.from = from;
		const leased = entry, lease = { changed };
		leased.lease = lease;
		return {
			content: leased.content, state: () => leased.state,
			current: () => this.entries.includes(leased) && leased.lease === lease,
			release: (discard = false) => {
				if (leased.lease !== lease) return;
				leased.lease = null;
				leased.content.remove();
				if (!this.entries.includes(leased)) return;
				if (discard || !this.alive || leased.state === 'error') this.dispose(leased);
				else {
					this.entries = this.entries.filter(item => item !== leased); this.entries.push(leased);
					const idle = this.entries.filter(item => !item.lease);
					for (const item of idle.slice(0, Math.max(0, idle.length - idleLimit))) this.dispose(item);
				}
			},
		};
	}
	private create(source: string, from: number): Entry {
		const content = createDetachedEl(this.document, 'div');
		content.className = 'paraflow-rendered-block-content markdown-rendered';
		content.classList.toggle('paraflow-mermaid-themed', hasMermaidContentTheme(this.view.dom));
		const entry: Entry = { source, from, content, state: 'loading', destroy: () => {}, lease: null,
			observer: new this.document.defaultView!.MutationObserver(() => {
				if (content.querySelector('.mermaid svg')) entry.state = 'ready';
				else if (content.querySelector('code.language-mermaid')?.textContent?.startsWith('Error parsing Mermaid diagram!')) entry.state = 'error';
				entry.lease?.changed();
			}) };
		entry.observer.observe(content, { childList: true, subtree: true, characterData: true });
		this.entries.push(entry);
		const failed = (error: unknown): void => {
			if (!this.entries.includes(entry)) return;
			entry.state = 'error';
			content.textContent = `无法预览 Mermaid${error instanceof Error ? `：${error.message}` : ''}`;
			entry.lease?.changed();
		};
		try {
			const render = this.options.renderMarkdown(mermaidMarkdownTheme(source, this.view.dom), content, this.view, 'mermaid');
			entry.destroy = () => render.destroy();
			void render.ready.then(() => {
				if (!this.entries.includes(entry)) return;
				// Ready can precede native Mermaid work; insertion must still happen.
				if (!content.querySelector('code.language-mermaid')) entry.state = 'ready';
				entry.lease?.changed();
			}, failed);
		} catch (error) { failed(error); }
		return entry;
	}
	private dispose(entry: Entry): void {
		if (!this.entries.includes(entry)) return;
		this.entries = this.entries.filter(item => item !== entry);
		entry.observer.disconnect(); entry.destroy();
	}
	destroy(): void {
		this.alive = false;
		for (const entry of [...this.entries]) this.dispose(entry);
	}
	syncContext(themeChanged: boolean, stylesheetChanged: boolean): boolean {
		if (stylesheetChanged) this.stylesheetRevision++;
		const changed = this.refreshContext(false, themeChanged) || this.invalidated;
		this.invalidated = false;
		return changed;
	}
}
export function mermaidPreviews(view: EditorView, options: RenderedBlockEditingOptions): MermaidPreviews {
	let pool = pools.get(view);
	if (!pool) { pool = new MermaidPreviews(view, options); pools.set(view, pool); }
	return pool;
}
export function destroyMermaidPreviews(view: EditorView): void {
	pools.get(view)?.destroy(); pools.delete(view);
}
export function refreshMermaidPreviews(view: EditorView, themeChanged: boolean, stylesheetChanged: boolean): boolean {
	return pools.get(view)?.syncContext(themeChanged, stylesheetChanged) ?? false;
}

export function mountMermaidPreview(element: HTMLElement, view: EditorView, options: RenderedBlockEditingOptions,
	source: string, from: number, refresh: () => void): { current: () => boolean; destroy: () => void } {
	const old = mounts.get(element);
	old?.stop();
	let previous = old?.previous ?? (old?.lease.current() && old.lease.state() === 'ready' ? old.lease : null);
	if (old && old.lease !== previous) old.lease.release(true);
	if (previous && !previous.current()) { previous.release(); previous = null; }
	if (!old) element.querySelector('.paraflow-rendered-block-content')!.remove();
	let alive = true, queued = false;
	const update = (): void => {
		element.dataset.renderState = lease.state();
		if (lease.state() === 'loading') element.setAttribute('aria-busy', 'true');
		else {
			element.removeAttribute('aria-busy');
			mount.previous?.release(); mount.previous = null;
			lease.content.classList.remove('is-pending');
		}
	};
	const changed = (): void => {
		if (!alive || queued) return;
		queued = true;
		queueMicrotask(() => {
			queued = false; if (!alive || !lease.current()) return;
			update(); refresh();
		});
	};
	const lease = mermaidPreviews(view, options).acquire(source, from, changed);
	const mount: Mount = { lease, previous, stop: () => { alive = false; } };
	mounts.set(element, mount);
	lease.content.classList.toggle('is-pending', Boolean(previous) && lease.state() === 'loading');
	element.append(lease.content); update();
	return { current: lease.current, destroy: () => {
		mount.stop(); lease.release(); mount.previous?.release();
		if (mounts.get(element) === mount) mounts.delete(element);
	} };
}
