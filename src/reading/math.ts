export interface ReadingMathOptions {
	readonly loadMathJax: () => Promise<void>;
	readonly finishRenderMath: () => Promise<void>;
	readonly renderMath: (source: string, display: boolean, owner: Document) => Promise<HTMLElement>;
	readonly getCachedMath?: (source: string, display: boolean, owner: Document) => HTMLElement | undefined;
	readonly onError: (error: unknown) => void;
}

export interface ReadingMath {
	capture(root: HTMLElement): void;
	render(root: HTMLElement, own: (element: HTMLElement, cleanup: () => void) => void): Promise<void>;
	destroy(): void;
}

interface MathSource { readonly source: string; readonly display: boolean }
interface MathOwner {
	readonly element: HTMLElement;
	readonly source: MathSource;
	readonly cleanup: () => void;
	ownedDocument: Document;
	ready: Promise<void>;
}

function mathElements(root: HTMLElement): HTMLElement[] {
	return [...(root.matches('.math') ? [root] : []), ...root.querySelectorAll<HTMLElement>('.math')];
}

export function createReadingMath(options: ReadingMathOptions): ReadingMath {
	const sources = new WeakMap<HTMLElement, MathSource>();
	const owners = new WeakMap<HTMLElement, MathOwner>();
	const active = new Set<MathOwner>();
	let alive = true;
	const attach = (element: HTMLElement, source: MathSource,
		own: (element: HTMLElement, cleanup: () => void) => void): Promise<void> => {
		const previous = owners.get(element);
		if (previous?.source === source && previous.ownedDocument === element.ownerDocument) return previous.ready;
		previous?.cleanup();
		let current = true;
		let rendered: HTMLElement | null = null;
		let nativeNodes: ChildNode[] | null = null;
		let addedClass = false;
		const valid = (): boolean => alive && current && sources.get(element) === source;
		const registration: MathOwner = { element, source, ownedDocument: element.ownerDocument, ready: Promise.resolve(), cleanup() {
			if (!current) return;
			current = false;
			if (rendered && element.childNodes.length === 1 && element.firstChild === rendered) {
				element.replaceChildren(...nativeNodes!);
			}
			if (addedClass) element.classList.remove('paraflow-math-rendered');
			if (owners.get(element) === registration) owners.delete(element);
			active.delete(registration);
		} };
		owners.set(element, registration); active.add(registration);
		// Bind to the math node rather than its replaceable section/recycler parent.
		own(element, registration.cleanup);
		registration.ready = (async () => {
			try {
				// Loaded native siblings are independent of the host's global pending queue.
				const cached = element.classList.contains('is-loaded')
					? options.getCachedMath?.(source.source, source.display, element.ownerDocument) : undefined;
				if (!cached) {
					await options.loadMathJax();
					if (!valid()) return;
					await options.finishRenderMath();
					if (!valid()) return;
				}
				if (!element.classList.contains('is-loaded')) { registration.cleanup(); return; }
				nativeNodes = [...element.childNodes];
				const ownerDocument = element.ownerDocument;
				registration.ownedDocument = ownerDocument;
				const result = cached ?? await options.renderMath(source.source, source.display, ownerDocument);
				if (!valid()) return;
				// A native refresh or document adoption during compilation supersedes this output.
				if (element.ownerDocument !== ownerDocument || element.childNodes.length !== nativeNodes.length ||
					nativeNodes.some((node, index) => element.childNodes[index] !== node)) {
					registration.cleanup(); return;
				}
				rendered = result;
				addedClass = !element.classList.contains('paraflow-math-rendered');
				element.replaceChildren(result);
				element.classList.add('paraflow-math-rendered');
			} catch (error) {
				if (valid()) options.onError(error);
				registration.cleanup();
			}
		})();
		return registration.ready;
	};
	return {
		capture(root) {
			if (!alive) return;
			for (const element of mathElements(root)) {
				if (!element.classList.contains('is-loaded')) sources.set(element,
					{ source: element.textContent, display: element.classList.contains('math-block') });
			}
		},
		async render(root, own) {
			if (!alive) return;
			await Promise.all(mathElements(root).flatMap(element => {
				const source = sources.get(element);
				return source ? [attach(element, source, own)] : [];
			}));
		},
		destroy() { alive = false; for (const registration of [...active]) registration.cleanup(); },
	};
}
