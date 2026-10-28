import { createDetachedEl } from '../dom';
import type { BodyTabOptions } from '../editor/body-tabs.js';

interface TabRunOwner {
	users: number;
	spans: readonly HTMLSpanElement[];
	restore(): void;
}

export { READING_TAB_CSS } from './tabs-css.js';

const excluded = 'pre, code, kbd, script, style, textarea, table, .math, mjx-container, .MathJax, svg, button, input, select, [contenteditable], .markdown-embed, .footnote-ref, .footnote-backref';

/** Keep each literal Tab as selectable text in its current content font. */
export function createReadingTabDisplay(): (root: HTMLElement, options: BodyTabOptions) => () => void {
	const owners = new WeakMap<Element, TabRunOwner>();
	return (root, options) => {
		const acquired = new Set<TabRunOwner>();
		const walker = root.ownerDocument.createTreeWalker(root, 4);
		const nodes: Text[] = [];
		while (walker.nextNode()) nodes.push(walker.currentNode as Text);
		for (const node of nodes) {
			if (!node.data.includes('\t') || !node.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6') || node.parentElement.closest(excluded)) continue;
			const existing = node.parentElement.closest('.paraflow-reading-tab');
			let owner = existing ? owners.get(existing) : undefined;
			if (!owner) {
				const pieces: Array<Text | HTMLSpanElement> = [], spans: HTMLSpanElement[] = [];
				for (const text of node.data.split(/(\t)/u)) {
					if (!text) continue;
					if (text[0] !== '\t') { pieces.push(root.ownerDocument.createTextNode(text)); continue; }
					const span = createDetachedEl(root.ownerDocument, 'span');
					span.className = 'paraflow-reading-tab';
					span.textContent = text; spans.push(span); pieces.push(span);
				}
				const parent = node.parentNode!;
				node.replaceWith(...pieces);
				owner = { users: 0, spans, restore() {
					for (const span of spans) owners.delete(span);
					if (pieces.every((piece, index) => piece.parentNode === parent && (index === 0 || pieces[index - 1]!.nextSibling === piece))) {
						node.data = pieces.map(piece => piece.textContent).join('');
						pieces[0]!.replaceWith(node);
						for (const piece of pieces.slice(1)) piece.remove();
					} else {
						// A native rerender may replace or move part of the original text group.
						for (const span of spans) if (span.parentNode) span.replaceWith(...span.childNodes);
					}
				} };
				for (const span of spans) owners.set(span, owner);
			}
			for (const span of owner.spans) {
				span.style.display = options.bodyTabMode === 'fixed' ? 'inline-block' : 'inline';
				span.style.tabSize = String(options.bodyTabSize);
			}
			if (!acquired.has(owner)) { owner.users++; acquired.add(owner); }
		}
		return () => { for (const owner of acquired) if (--owner.users === 0) owner.restore(); };
	};
}
