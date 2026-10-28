import { createDetachedEl } from '../dom';
export interface MediaTableDisplayOptions {
	images: boolean;
	imageCenter: boolean;
	imageSourceReveal?: boolean;
	tableDisplay: boolean;
	tableEditing?: boolean;
	tableAutoWrap?: boolean;
	tableBreakHints?: boolean;
}

export { MEDIA_TABLE_CSS } from './media-table-css.js';

const IMAGE_FRAME = '.image-embed > .image-wrapper';
const IMAGE_CONTAINER = `a, span.image-embed, div.image-embed, span.cm-html-embed, ${IMAGE_FRAME}`;
const IMAGE = 'img:not(.cm-widgetBuffer)';
const IMAGE_BLOCK = 'p, li, div';
const KNOWN_DIV = `.callout, .callout-content, .image-embed, ${IMAGE_FRAME}, .cm-content, .cm-line, .cm-embed-block, .markdown-preview-section, .markdown-rendered, [class^="el-"]`;

function within(root: HTMLElement, selector: string): HTMLElement[] {
	return [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll<HTMLElement>(selector)];
}

function chain(element: HTMLElement, root: HTMLElement): HTMLElement[] {
	const result: HTMLElement[] = [];
	for (let node: HTMLElement | null = element; node; node = node.parentElement) {
		result.push(node);
		if (node === root) break;
	}
	return result;
}

function hasPlacement(element: HTMLElement): boolean {
	const style = element.style;
	return element.hasAttribute('align') || !!(style.textAlign || style.cssFloat || style.margin ||
		style.marginLeft || style.marginRight || style.marginInline || style.marginInlineStart || style.marginInlineEnd ||
		style.position || style.left || style.right || style.inset || style.alignSelf || style.justifySelf);
}

function foreignImageLayout(element: HTMLElement, root: HTMLElement): boolean {
	if (element.closest('table, .markdown-embed, .canvas-node, .dataview')) return true;
	return chain(element, root).some(node => {
		if (/flex|grid/u.test(node.style.display)) return true;
		return node.tagName === 'DIV' && node.classList.length > 0 && !node.matches(KNOWN_DIV);
	});
}

function standaloneBlock(image: HTMLElement, root: HTMLElement): HTMLElement | null {
	if (foreignImageLayout(image, root)) return null;
	if (image === root) return image;
	let block = image.parentElement!;
	while (block !== root && block.matches(IMAGE_CONTAINER)) block = block.parentElement!;
	if (!block.matches(IMAGE_BLOCK) && block !== root) return null;
	if (block.querySelectorAll(IMAGE).length !== 1) return null;
	const text = block.ownerDocument.createTreeWalker(block, 4);
	for (let node = text.nextNode(); node; node = text.nextNode()) {
		if (node.textContent?.trim() && !node.parentElement?.closest('.embed-actions, .image-resize-corner')) return null;
	}
	return block;
}

function manualStyle(cell: HTMLElement, table: HTMLElement, property: 'background' | 'fontWeight'): boolean {
	return chain(cell, table).some(element => property === 'background'
		? !!(element.style.background || element.style.backgroundColor || element.getAttribute('bgcolor'))
		: !!element.style.fontWeight);
}

const IMAGE_HEIGHT = '--paraflow-image-constrained-height';
const CONSTRAINED_IMAGE = 'paraflow-display-image-constrained';

interface ImageLength { pixels: number; percent: number }

function declaredDimension(image: HTMLImageElement, dimension: 'width' | 'height'): ImageLength | null {
	const value = image.style[dimension] || image.getAttribute(dimension) || '';
	if (/^\d+(?:\.\d+)?(?:px)?$/u.test(value)) return { pixels: Number.parseFloat(value), percent: 0 };
	if (!value) return null;
	const computed = image.computedStyleMap?.().get(dimension);
	if (!computed || !('toSum' in computed)) return null;
	try {
		const result: ImageLength = { pixels: 0, percent: 0 };
		const terms = Array.from((computed as CSSNumericValue).toSum('px', 'percent').values) as CSSUnitValue[];
		for (const term of terms) {
			if (term.unit === 'px') result.pixels += term.value;
			if (term.unit === 'percent') result.percent += term.value;
		}
		return result;
	} catch {
		// Keywords and non-additive CSS expressions have no numeric length sum.
		return null;
	}
}

function contentSize(element: HTMLElement, dimension: 'width' | 'height'): number {
	const style = element.ownerDocument.defaultView!.getComputedStyle(element);
	const extras = (dimension === 'width' ? [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
		: [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth])
		.reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
	return element.getBoundingClientRect()[dimension] - extras;
}

function resolveLength(length: ImageLength | null, block: HTMLElement, dimension: 'width' | 'height'): number | null {
	return length ? length.pixels + (length.percent ? length.percent * contentSize(block, dimension) / 100 : 0) : null;
}

function constrainedHeight(image: HTMLImageElement, block: HTMLElement, widthLength: ImageLength | null, heightLength: ImageLength | null): string | null {
	const height = resolveLength(heightLength, block, 'height');
	const width = resolveLength(widthLength, block, 'width');
	if (!height || (image.style.width && !width)) return null;
	const ratio = width ? width / height : image.naturalWidth / image.naturalHeight;
	if (!Number.isFinite(ratio) || ratio <= 0) return null;
	// A height-only image's own width shrinks with our height. Use its containing
	// block to detect when that constraint can be relaxed again.
	const renderedWidth = width ? contentSize(image, 'width') : Math.min(height * ratio, contentSize(block, 'width') || contentSize(image, 'width'));
	if (renderedWidth <= 0 || renderedWidth >= (width ?? height * ratio) - 0.5) return null;
	return `${Math.round(renderedWidth / ratio * 1000) / 1000}px`;
}

export class MediaTableDisplayController {
	private owned = new Map<HTMLElement, Set<string>>();
	private requested: Map<HTMLElement, Set<string>> | null = null;
	private addedClassAttributes = new Set<HTMLElement>();
	private tableViewports = new Set<HTMLElement>();
	private requestedViewports = new Set<HTMLElement>();
	private cleanupImages: (() => void) | null = null;

	constructor(readonly root: HTMLElement, private readonly reading = false, private readonly owns: (element: Element) => boolean = () => true) {}

	update(options: MediaTableDisplayOptions): void {
		this.cleanupImages?.();
		this.cleanupImages = null;
		this.requested = new Map();
		this.requestedViewports.clear();
		if (options.images) this.images(options.imageCenter);
		if (options.tableDisplay) this.tables();
		if (options.tableDisplay || options.tableEditing) this.tableWrapping(options.tableAutoWrap !== false);
		for (const [element, names] of this.owned) for (const name of names) {
			if (!this.requested.get(element)?.has(name)) this.remove(element, name);
		}
		this.requested = null;
		for (const viewport of this.tableViewports) if (!this.requestedViewports.has(viewport)) {
			viewport.replaceWith(...viewport.childNodes);
			this.tableViewports.delete(viewport);
		}
	}

	destroy(): void {
		this.cleanupImages?.();
		this.cleanupImages = null;
		for (const [element, names] of this.owned) for (const name of names) this.remove(element, name);
		for (const viewport of this.tableViewports) viewport.replaceWith(...viewport.childNodes);
		this.tableViewports.clear();
		this.requestedViewports.clear();
	}

	private add(element: HTMLElement, name: string): void {
		if (this.requested) {
			let names = this.requested.get(element);
			if (!names) this.requested.set(element, names = new Set());
			names.add(name);
		}
		if (element.classList.contains(name)) return;
		if (!element.hasAttribute('class')) this.addedClassAttributes.add(element);
		element.classList.add(name);
		let names = this.owned.get(element);
		if (!names) this.owned.set(element, names = new Set());
		names.add(name);
	}

	private remove(element: HTMLElement, name: string): void {
		const names = this.owned.get(element);
		if (!names?.delete(name)) return;
		element.classList.remove(name);
		if (!names.size) {
			this.owned.delete(element);
			if (this.addedClassAttributes.delete(element) && !element.classList.length) element.removeAttribute('class');
		}
	}

	private images(center: boolean): void {
		const sizedImages: Array<{ image: HTMLImageElement; block: HTMLElement }> = [];
		for (const image of within(this.root, IMAGE).filter(this.owns)) {
			const block = standaloneBlock(image, this.root);
			if (!block) continue;
			this.add(image, 'paraflow-display-image');
			if (!image.hasAttribute('height') && !image.style.height) this.add(image, 'paraflow-display-image-natural-height');
			else sizedImages.push({ image: image as HTMLImageElement, block: block === image ? image.parentElement ?? image : block });
			if (!center || chain(image, this.root).some(hasPlacement)) continue;
			this.add(image, 'paraflow-display-image-center');
			for (const wrapper of chain(image, block).slice(1)) {
				if (wrapper.matches(IMAGE_FRAME)) this.add(wrapper, 'paraflow-display-image-frame');
				else if (wrapper.matches(IMAGE_CONTAINER)) this.add(wrapper, 'paraflow-display-image-container');
			}
		}
		if (sizedImages.length) this.observeImageSizes(sizedImages);
	}

	private observeImageSizes(images: Array<{ image: HTMLImageElement; block: HTMLElement }>): void {
		const ownerWindow = this.root.ownerDocument.defaultView!;
		const states = images.map(({ image, block }) => ({ image, block, original: image.style.getPropertyValue(IMAGE_HEIGHT),
			priority: image.style.getPropertyPriority(IMAGE_HEIGHT), hadStyle: image.hasAttribute('style'), applied: null as string | null }));
		let frame: number | null = null;
		const restore = (state: typeof states[number]) => {
			if (state.applied === null) return;
			if (state.image.style.getPropertyValue(IMAGE_HEIGHT) === state.applied) {
				if (state.original) state.image.style.setProperty(IMAGE_HEIGHT, state.original, state.priority);
				else state.image.style.removeProperty(IMAGE_HEIGHT);
				if (!state.hadStyle && !state.image.style.length) state.image.removeAttribute('style');
			}
			state.applied = null;
		};
		const schedule = () => {
			if (frame !== null) return;
			frame = ownerWindow.requestAnimationFrame(() => {
				frame = null;
				// Suspend only our projection, then batch all current authored-size
				// and geometry reads before restoring projections in this same frame.
				for (const state of states) {
					if (state.applied !== null) this.remove(state.image, CONSTRAINED_IMAGE);
				}
				const heights = states.map(({ image, block }) => constrainedHeight(image, block,
					declaredDimension(image, 'width'), declaredDimension(image, 'height')));
				states.forEach((state, index) => {
					const height = heights[index]!;
					if (height === null) {
						restore(state);
						this.remove(state.image, CONSTRAINED_IMAGE);
					} else {
						if (height !== state.applied) state.image.style.setProperty(IMAGE_HEIGHT, height);
						state.applied = height;
						this.add(state.image, CONSTRAINED_IMAGE);
					}
				});
			});
		};
		const observer = ownerWindow.ResizeObserver ? new ownerWindow.ResizeObserver(schedule) : null;
		ownerWindow.addEventListener('resize', schedule);
		for (const { image, block } of images) {
			observer?.observe(image);
			observer?.observe(block);
			image.addEventListener('load', schedule);
		}
		schedule();
		this.cleanupImages = () => {
			observer?.disconnect();
			ownerWindow.removeEventListener('resize', schedule);
			if (frame !== null) ownerWindow.cancelAnimationFrame(frame);
			for (const { image } of images) image.removeEventListener('load', schedule);
			for (const state of states) restore(state);
		};
	}

	private tables(): void {
		for (const table of within(this.root, 'table').filter(this.owns)) {
			if (table.closest('.cm-editor') && table.closest('td, th')) continue;
			// Reading postprocessors may run before their section joins the document.
			const reading = this.reading || table.closest('.markdown-reading-view') !== null;
			this.add(table, 'paraflow-display-table');
			const wrapper = table.parentElement;
			// Keep the native scroll owner so table selection and controls share its coordinates.
			if (!table.closest('.cm-table-widget')) {
				if (wrapper && reading && this.tableViewports.has(wrapper)) {
					this.requestedViewports.add(wrapper);
					this.add(wrapper, 'paraflow-display-table-viewport');
				}
				else if (table !== this.root && wrapper && (wrapper.matches('.table-wrapper, .paraflow-html-table-editor, .markdown-source-view.is-live-preview .cm-html-embed') || reading && wrapper.matches('.el-table,.el-div'))) this.add(wrapper, 'paraflow-display-table-viewport');
				else if (table !== this.root && reading) {
					// Mixed Reading containers keep prose outside each table's scroll viewport.
					const viewport = createDetachedEl(table.ownerDocument, 'div');
					this.add(viewport, 'paraflow-display-table-viewport');
					table.before(viewport); viewport.append(table);
					this.tableViewports.add(viewport);
					this.requestedViewports.add(viewport);
				}
				else this.add(table, 'paraflow-display-table-self-scroll');
			}
			const rows = [...table.querySelectorAll('tr')].filter(row => row.closest('table') === table);
			rows.forEach((row, index) => {
				if (!manualStyle(row, row, 'background')) this.add(row, 'paraflow-display-row-neutral');
				for (const cell of [...row.cells]) {
					if (reading) {
						let tail=cell.lastChild;
						while(tail?.nodeType===3&&/^[\t\r\n ]*$/u.test(tail.textContent!))tail=tail.previousSibling;
						if(tail instanceof cell.ownerDocument.defaultView!.HTMLBRElement&&!tail.hasAttribute('style'))this.add(cell,'paraflow-table-terminal-break');
					}
					const header = cell.tagName === 'TH';
					if (!manualStyle(cell, table, 'background')) this.add(cell, header ? 'paraflow-display-header'
						: index % 2 === 0 ? 'paraflow-display-cell-stripe' : 'paraflow-display-cell-base');
					if (header && !manualStyle(cell, table, 'fontWeight')) this.add(cell, 'paraflow-display-header-weight');
				}
			});
		}
	}

	private tableWrapping(wrap: boolean): void {
		for (const table of within(this.root, 'table').filter(this.owns)) {
			if (table.closest('.cm-editor') && table.closest('td, th')) continue;
			this.add(table, wrap ? 'paraflow-table-wrap' : 'paraflow-table-nowrap');
			if (!wrap) continue;
			for (const cell of table.querySelectorAll<HTMLTableCellElement>('td,th')) {
				if (cell.closest('table') !== table) continue;
				// Short labels provide natural min-content constraints; long tokens may wrap.
				const content = Array.from(cell.querySelectorAll<HTMLElement>('.table-cell-wrapper'))
					.find(wrapper => !wrapper.hidden && wrapper.getAttribute('aria-hidden') !== 'true' && wrapper.style.display !== 'none') ?? cell;
				const text = content.textContent?.trim() ?? '';
				if (text.length <= 24 && !cell.querySelector('pre,table,img,.image-embed')) this.add(cell, 'paraflow-table-cell-keep-words');
			}
		}
	}
}
