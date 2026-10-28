/** Create detached nodes with Obsidian's helpers in the owning editor window. */
export function createDetachedEl<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K): HTMLElementTagNameMap[K] {
	const element = document.createDocumentFragment().createEl(tag);
	element.remove();
	return element;
}

export function createDetachedSvg<K extends keyof SVGElementTagNameMap>(document: Document, tag: K): SVGElementTagNameMap[K] {
	const element = document.createDocumentFragment().createSvg(tag);
	element.remove();
	return element;
}
