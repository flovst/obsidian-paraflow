import { ViewPlugin, type EditorView, type DecorationSet } from '@codemirror/view';
import { geometryOnlyDecorations } from './line-layout.js';

interface IndentEntry { text: string; size: number; dirty: boolean }
export interface NativeIndent {
	view: EditorView;
	indentCache: Map<number, IndentEntry>;
	getCached(line: number, prefix: string): IndentEntry | null;
	buildDeco(view: EditorView): void;
	updateDomInternal: () => void;
	decorations?: DecorationSet;
}

function controller(view: EditorView): NativeIndent | null {
	const plugins = (view as unknown as { plugins?: { value?: unknown }[] }).plugins ?? [];
	const matches = plugins.map(plugin => plugin.value).filter((value): value is NativeIndent => {
		if (!value || typeof value !== 'object') return false;
		const candidate = value as Partial<NativeIndent>;
		return candidate.view === view && candidate.indentCache instanceof Map &&
			typeof candidate.getCached === 'function' && typeof candidate.buildDeco === 'function' &&
			typeof candidate.updateDomInternal === 'function';
	});
	return matches.length === 1 ? matches[0]! : null;
}

export function createNativeIndentOwnership(eligible: (view: EditorView, row: HTMLElement) => boolean, origins?: (view: EditorView) => Set<number>) {
	return ViewPlugin.fromClass(class {
		owner: NativeIndent | null = null;
		release: (() => void) | null = null;
		disposed = false;
		pending = false;
		constructor(readonly view: EditorView) {
			this.bind();
			queueMicrotask(() => { if (!this.disposed) this.bind(); });
		}
		update() {
			this.bind();
			if (this.pending) return;
			this.pending = true;
			queueMicrotask(() => { this.pending = false; if (!this.disposed) this.bind(); });
		}
		bind() {
			const next = controller(this.view);
			if (next === this.owner) return;
			this.release?.(); this.owner = next;
			if (!next) { this.release = null; return; }
			const restoreDecorations = origins && next.decorations ? ownIndentDecorations(next, () => origins(this.view)) : () => {};
			const restorePadding = ownNativePadding(next, row => eligible(this.view, row), !!origins);
			this.release = () => { restorePadding(); restoreDecorations(); };
		}
		destroy() { this.disposed = true; this.release?.(); this.release = null; this.owner = null; }
	});
}

/** Native measurement may change its hanging indent, but an owned row keeps its padding. */
export function ownNativePadding(native: NativeIndent, eligible: (row: HTMLElement) => boolean, origin = false): () => void {
	const original = native.updateDomInternal;
	const originalDescriptor = Object.getOwnPropertyDescriptor(native, 'updateDomInternal');
	const update = function (this: NativeIndent) {
		const releases: (() => void)[] = [];
		try {
			for (const row of this.view.contentDOM.children) {
				if (!row.instanceOf(HTMLElement) || !eligible(row)) continue;
				const style = row.style;
				for (const property of origin ? ['paddingInlineStart', 'textIndent'] as const : ['paddingInlineStart'] as const) {
					const descriptor = Object.getOwnPropertyDescriptor(style, property);
					const value = style[property];
					Object.defineProperty(style, property, { configurable: true, get: () => value, set: () => {} });
					releases.push(() => {
						// CSSStyleDeclaration exposes synthetic own descriptors. Re-defining
						// one would shadow the native CSSOM setter after the measurement.
						if (descriptor?.get || descriptor?.set) Object.defineProperty(style, property, descriptor);
						else Reflect.deleteProperty(style, property);
					});
				}
			}
			original.call(this);
		} finally { for (const release of releases.reverse()) release(); }
	};
	native.updateDomInternal = update;
	return () => {
		if (native.updateDomInternal !== update) return;
		if (originalDescriptor) Object.defineProperty(native, 'updateDomInternal', originalDescriptor);
		else Reflect.deleteProperty(native, 'updateDomInternal');
	};
}

function ownIndentDecorations(native: NativeIndent, origins: () => Set<number>): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(native, 'decorations')!;
	let raw = geometryOnlyDecorations(native.decorations!), reading = false;
	let cache: { raw: DecorationSet; state: EditorView['state']; origins: Set<number>; value: DecorationSet } | null = null;
	const get = (): DecorationSet => {
		if (reading) return raw;
		if (cache?.raw === raw && cache.state === native.view.state) return cache.value;
		reading = true;
		try {
			const owned = origins();
			const value = cache?.raw === raw && cache.origins === owned ? cache.value : geometryOnlyDecorations(raw.update({ filter: from => !owned.has(from) }));
			cache = { raw, state: native.view.state, origins: owned, value };
			return value;
		} finally { reading = false; }
	};
	Object.defineProperty(native, 'decorations', { configurable: true, enumerable: descriptor.enumerable, get,
		set: (value: DecorationSet) => { raw = geometryOnlyDecorations(value); } });
	return () => {
		if (Object.getOwnPropertyDescriptor(native, 'decorations')?.get === get) Object.defineProperty(native, 'decorations', { ...descriptor, value: raw });
	};
}
