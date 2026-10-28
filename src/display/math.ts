import { HTMLAdaptor } from 'mathjax-full/js/adaptors/HTMLAdaptor.js';
import type { browserAdaptor } from 'mathjax-full/js/adaptors/browserAdaptor.js';
import { HTMLHandler } from 'mathjax-full/js/handlers/html/HTMLHandler.js';
import type { InputJax } from 'mathjax-full/js/core/InputJax.js';
import type { MmlFactory } from 'mathjax-full/js/core/MmlTree/MmlFactory.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { handleRetriesFor } from 'mathjax-full/js/util/Retries.js';

export interface NativeMathJax {
	readonly config: { readonly tex?: Record<string, unknown> };
	readonly startup: { readonly document: { readonly inputJax: readonly InputJax<HTMLElement, Text, Document>[]; readonly mmlFactory: MmlFactory } };
}

export interface SvgMathRendererOptions {
	readonly document: Document;
	readonly loadMathJax: () => Promise<void>;
	readonly getMathJax: () => NativeMathJax;
}

// MathJax 4 chemistry arrows use a separate font absent from the SVG 3 font.
// Resolve their TeX commands through the host's ordinary arrow implementations.
const chemistryArrows = {
	mhchemrightarrow: '\\rightarrow', mhchemleftarrow: '\\leftarrow', mhchemleftrightarrow: '\\leftrightarrow',
	mhchemlongrightarrow: '\\longrightarrow', mhchemlongleftarrow: '\\longleftarrow', mhchemlongleftrightarrow: '\\longleftrightarrow',
	mhchemxrightarrow: '\\xrightarrow', mhchemxleftarrow: '\\xleftarrow', mhchemxleftrightarrow: '\\xleftrightarrow',
};

const completedLimit = 128;
let outputIdentity = 0;

/** Templates never enter a view. Clone local labels as well as nodes. */
function copyOutput(template: HTMLElement): HTMLElement {
	const result = template.cloneNode(true) as HTMLElement;
	const prefix = `paraflow-math-${++outputIdentity}-`;
	const ids = new Map<string, string>();
	for (const node of [result, ...result.querySelectorAll<HTMLElement>('[id]')]) {
		if (!node.id) continue;
		const id = prefix + node.id;
		ids.set(node.id, id); node.id = id;
	}
	if (!ids.size) return result;
	for (const node of [result, ...result.querySelectorAll('*')]) {
		for (const attribute of [...node.attributes]) {
			if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
				node.setAttribute(attribute.name, attribute.value.split(/\s+/u).map(id => ids.get(id) ?? id).join(' '));
			} else if (attribute.localName === 'href' && attribute.value.startsWith('#')) {
				const id = ids.get(attribute.value.slice(1));
				if (id) node.setAttributeNS(attribute.namespaceURI, attribute.name, '#' + id);
			}
		}
	}
	return result;
}

/** Reuse the host TeX implementation/configuration, never its mutable parser state. */
export function createSvgMathRenderer(options: SvgMathRendererOptions): {
	renderMath(this: void, source: string, display: boolean, document?: Document): Promise<HTMLElement>;
	getCachedMath(this: void, source: string, display: boolean, document?: Document): HTMLElement | undefined;
	destroy(): void;
} {
	let readiness: Promise<void> | null = null;
	let queue: Promise<unknown> = Promise.resolve();
	let started = false;
	type Owner = { completed: Map<string, HTMLElement>; pending: Map<string, Promise<HTMLElement>>; cleanup: () => void; alive: boolean };
	const owners = new Map<Document, Owner>();
	const closed = new WeakSet<Document>();
	const references = new WeakMap<object, number>();
	let referenceCount = 0;
	let loaded = false;
	let context: { native: NativeMathJax; host: InputJax<HTMLElement, Text, Document>; factory: object; configuration: Record<string, unknown>; signature: string } | null = null;
	let alive = true;
	const requireAlive = (): void => { if (!alive) throw new Error('Math renderer destroyed'); };
	const ready = (): Promise<void> => readiness ??= options.loadMathJax().then(() => { loaded = true; }).catch((error: unknown) => {
		readiness = null;
		throw error;
	});
	const currentContext = () => {
		const native = options.getMathJax();
		const host = native.startup?.document.inputJax.find(input => input.name === 'TeX');
		if (!host) throw new Error('Native TeX renderer is unavailable');
		const configuration = { ...native.config.tex, ...host.options };
		// Functions in the host configuration affect TeX; JSON alone would omit them.
		const signature = JSON.stringify(configuration, (_key, value: unknown) => {
			if (typeof value !== 'function') return value;
			if (!references.has(value)) references.set(value, ++referenceCount);
			return { paraflowFunction: references.get(value) };
		});
		const factory = native.startup.document.mmlFactory.constructor;
		if (!context || context.host !== host || context.factory !== factory || context.signature !== signature) {
			context = { native, host, factory, configuration, signature };
			for (const owner of owners.values()) { owner.completed.clear(); owner.pending.clear(); }
		}
		return context;
	};
	const ownerState = (document: Document): Owner => {
		if (closed.has(document) || !document.defaultView) throw new Error('Math renderer document destroyed');
		const existing = owners.get(document);
		if (existing) return existing;
		const state: Owner = { completed: new Map(), pending: new Map(), alive: true, cleanup() {
			state.alive = false; state.completed.clear(); state.pending.clear();
			owners.delete(document); closed.add(document);
			document.defaultView?.removeEventListener('unload', state.cleanup);
		} };
		document.defaultView.addEventListener('unload', state.cleanup, { once: true });
		owners.set(document, state);
		return state;
	};
	const cached = (state: Owner, key: string): HTMLElement | undefined => {
		const template = state.completed.get(key);
		if (!template) return undefined;
		state.completed.delete(key); state.completed.set(key, template);
		return copyOutput(template);
	};
	return {
		getCachedMath(source, display, owner = options.document) {
			requireAlive();
			if (!loaded) return undefined;
			currentContext();
			return cached(ownerState(owner), JSON.stringify([source, display]));
		},
		async renderMath(source, display, owner = options.document) {
			requireAlive();
			await ready(); requireAlive();
			const requestContext = currentContext();
			const state = ownerState(owner), key = JSON.stringify([source, display]);
			const completed = cached(state, key);
			if (completed) return completed;
			const existing = state.pending.get(key);
			if (existing) return copyOutput(await existing);
			const requireCurrent = (): void => {
				requireAlive();
				if (!state.alive) throw new Error('Math renderer document destroyed');
				if (context !== requestContext) throw new Error('Math renderer configuration changed');
			};
			const render = async (): Promise<HTMLElement> => {
				requireCurrent();
				// A resolved Promise only yields to microtasks. Let input and painting run
				// between isolated conversions, including when MathJax is already ready.
				// The main document owns the queue; closing a popout cannot cancel its yield.
				if (started) await new Promise<void>(resolve => options.document.defaultView!.setTimeout(resolve, 0));
				started = true;
				requireCurrent();
				const { native, host, configuration } = requestContext;
				const TeX = host.constructor as new (configuration: Record<string, unknown>) => InputJax<HTMLElement, Text, Document>;
				// Each preview has independent labels/counters/macros. In particular, never
				// call the host texReset or copy its already-mutated parseOptions options.
				const input = new TeX({ ...configuration, macros: {
					...chemistryArrows, ...(configuration.macros as Record<string, unknown> | undefined),
				} });
				// MathJax 3's minimal DOM declarations predate nullable DOM nodeValue.
				const OwnerAdaptor = HTMLAdaptor as unknown as new (window: Window) => ReturnType<typeof browserAdaptor>;
				const adaptor = new OwnerAdaptor(owner.defaultView!);
				const svg = new SVG({ fontCache: 'none' });
				// TeX extensions register node kinds in their own MathJax module realm.
				// A factory from the output-only bundle lacks those input node classes.
				const Factory = native.startup.document.mmlFactory.constructor as new () => MmlFactory;
				const output = new HTMLHandler(adaptor).create(owner, { InputJax: input, OutputJax: svg, MmlFactory: new Factory() });
				let result: HTMLElement;
				try {
					result = await handleRetriesFor(() => {
						requireCurrent();
						return output.convert(source, { display }) as HTMLElement;
					}) as HTMLElement;
					requireCurrent();
				} finally { output.clear(); }
				const error = result.querySelector('[data-mjx-error]');
				if (error) throw new Error(error.getAttribute('data-mjx-error')!);
				result.classList.add('paraflow-svg-math', 'paraflow-math-output');
				// MathJax creates math-tooltip nodes during conversion and later moves them
				// between its hidden SVG holder and the output root.
				for (const tool of result.querySelectorAll('mjx-tool')) tool.classList.add('paraflow-math-tool');
				for (const tip of result.querySelectorAll('mjx-tip')) tip.classList.add('paraflow-math-tip');

				state.completed.set(key, result);
				if (state.completed.size > completedLimit) state.completed.delete(state.completed.keys().next().value!);
				return result;
			};
			const pending = queue.then(render);
			state.pending.set(key, pending);
			queue = pending.catch(() => {});
			try { return copyOutput(await pending); }
			finally { if (state.pending.get(key) === pending) state.pending.delete(key); }
		},
		destroy() { alive = false; for (const entry of [...owners.values()]) entry.cleanup(); context = null; },
	};
}
