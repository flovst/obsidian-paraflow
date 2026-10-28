/** Preserve ownership for editor windows and inert DOMParser documents. */
export function createOwnedFragment(owner: Document): DocumentFragment {
	return owner.adoptNode(createFragment());
}

/** Create detached nodes with Obsidian's helpers in the owning editor window. */
export function createDetachedEl<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K): HTMLElementTagNameMap[K] {
	const element = createOwnedFragment(document).createEl(tag);
	element.remove();
	return element;
}

export function createDetachedSvg<K extends keyof SVGElementTagNameMap>(document: Document, tag: K): SVGElementTagNameMap[K] {
	const element = createOwnedFragment(document).createSvg(tag);
	element.remove();
	return element;
}
