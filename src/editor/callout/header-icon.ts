import type { EditorView } from '@codemirror/view';

interface NativeIcons {
	getIcon(id: string): SVGSVGElement | null;
	sanitizeHTMLToDom(html: string): DocumentFragment;
}

const liveIcons = new WeakMap<Document, Set<() => void>>();

/** Host CSS and ParaFlow theme changes invalidate the icons in each owner window. */
export function refreshCalloutHeaderIcons(owner: Document): void {
	for (const refresh of liveIcons.get(owner) ?? []) refresh();
}

function cssIcon(value: string): string {
	const token = value.trim();
	if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1).replace(/\\'/gu, "'");
	if (token.startsWith('"')) {
		try {
			const decoded: unknown = JSON.parse(token);
			if (typeof decoded === 'string') return decoded;
		} catch { /* The host also accepts an unquoted icon token. */ }
	}
	return token;
}

/** Resolve native CSS while connected, before the title widget is inserted. */
export function renderCalloutHeaderIcon(source: string, element: HTMLElement, view: EditorView, native: NativeIcons): (() => void) & { refresh: () => void } {
	const [, type, metadata = ''] = /^> \[!([^|\]]+)(?:\|([^\]]*))?\]$/u.exec(source)!;
	const owner = element.ownerDocument;
	let current: string | undefined;
	function refresh(): void {
		const probe = owner.createElement('div');
		probe.className = 'callout paraflow-callout-icon-probe';
		probe.dataset.callout = type!;
		probe.dataset.calloutMetadata = metadata;
		probe.setAttribute('aria-hidden', 'true');
		view.contentDOM.append(probe);
		let name: string;
		try { name = cssIcon(owner.defaultView!.getComputedStyle(probe).getPropertyValue('--callout-icon')); }
		finally { probe.remove(); }
		if (name === current) return;
		const svg = name.startsWith('<svg') ? native.sanitizeHTMLToDom(name).firstElementChild : native.getIcon(name);
		if (svg?.namespaceURI === 'http://www.w3.org/2000/svg' && svg.localName === 'svg') {
			svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
			if (name.startsWith('<svg')) { svg.setAttribute('fill', 'currentColor'); svg.setAttribute('stroke', 'currentColor'); }
			element.replaceChildren(svg);
		} else element.replaceChildren();
		current = name;
	}
	refresh();
	let icons = liveIcons.get(owner);
	if (!icons) liveIcons.set(owner, icons = new Set());
	icons.add(refresh);
	return Object.assign(() => { icons.delete(refresh); }, { refresh });
}
