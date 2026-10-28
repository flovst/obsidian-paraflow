import { createDetachedEl } from '../dom';
import { detailsContainers } from '../editor/rendered-blocks/details-source.js';
import type { ReadingSectionSource } from './section-rhythm.js';
import { readingDetailsBodyBlocks, registerReadingDetailsOwner } from './details-ownership.js';
import type { DetailsOpenState } from '../display/details-open-state.js';

export interface ReadingDetailsState { cache: DetailsOpenState; path: string }

function isDetailsElement(element: HTMLElement): element is HTMLDetailsElement {
	return element.localName === 'details';
}

export { READING_DETAILS_CSS } from './details-css.js';

/** Render each complete disclosure body through the same Markdown pipeline as ordinary content. */
export async function renderReadingDetails(root: HTMLElement, section: ReadingSectionSource,
	render: (source: string, target: HTMLElement) => Promise<void>,
	register: (root: HTMLElement, source: string) => () => void, state?: ReadingDetailsState): Promise<() => void> {
	state?.cache.initialize(state.path, section.text);
	return renderDetails(root, section, render, register, { section: root, source: section.text, firstLine: 0 }, state);
}

async function renderDetails(root: HTMLElement, section: ReadingSectionSource,
	render: (source: string, target: HTMLElement) => Promise<void>,
	register: (root: HTMLElement, source: string) => () => void,
	owner: { section: HTMLElement; source: string; firstLine: number }, state?: ReadingDetailsState): Promise<() => void> {
	const source = section.text;
	const blocks = detailsContainers(source);
	const outerBlocks = blocks.filter(block => !blocks.some(parent => parent.from < block.from && parent.to >= block.to));
	const lineAt = (position: number) => source.slice(0, position).split('\n').length - 1;
	// Obsidian splits raw HTML at blank lines, so a disclosure can span several
	// independently recycled preview sections. Its header owns the complete body.
	const continuation = outerBlocks.find(block => lineAt(block.from) < section.lineStart
		&& section.lineStart <= lineAt(block.to) && section.lineEnd <= lineAt(block.to));
	if (continuation) {
		const hidden = root.classList.contains('paraflow-details-continuation');
		root.classList.add('paraflow-details-continuation');
		return () => { root.classList.toggle('paraflow-details-continuation', hidden); };
	}
	const outer = outerBlocks.filter(block => section.lineStart <= lineAt(block.from) && lineAt(block.from) <= section.lineEnd);
	const elements = [...(isDetailsElement(root) ? [root] : []), ...root.querySelectorAll<HTMLDetailsElement>('details')]
		.filter(element => !element.parentElement?.closest('details') || element.parentElement.closest('details') === root.parentElement?.closest('details'));
	const releases: (() => void)[] = [];
	for (let index = 0; index < Math.min(outer.length, elements.length); index++) {
		const block = outer[index]!, element = elements[index]!;
		const summary = element.querySelector<HTMLElement>(':scope > summary');
		if (!summary) continue;
		const body = createDetachedEl(element.ownerDocument, 'div'); body.className = 'paraflow-details-body markdown-rendered';
		const quoteDepth = (/^(?:[ \t]*>[ \t]?)+/u.exec(source.slice(block.from))?.[0].match(/>/gu) ?? []).length;
		const markdown = source.slice(block.bodyFrom, block.bodyTo).split('\n').map(line => {
			// Quote spacing can vary by row, including a bare marker on a blank row.
			for (let depth = 0; depth < quoteDepth; depth++) line = line.replace(/^[ \t]*>[ \t]?/u, '');
			return line;
		}).join('\n');
		await render(markdown, body);
		const original = [...element.childNodes].filter(node => node !== summary);
		for (const node of original) node.remove();
		element.append(body);
		const firstLine = owner.firstLine + lineAt(block.bodyFrom);
		const releaseNested = await renderDetails(body, { text: markdown, lineStart: 0, lineEnd: markdown.split('\n').length - 1 }, render, register,
			{ ...owner, firstLine }, state);
		let releaseState = () => {};
		if (state) {
			const absoluteLine = owner.firstLine + lineAt(block.from);
			const absoluteFrom = owner.source.split('\n').slice(0, absoluteLine).reduce((length, line) => length + line.length + 1, 0);
			const { cache, path } = state;
			const sync = () => {
				if (cache.source(path) === owner.source) element.open = cache.opened(path, owner.source).get(absoluteFrom) ?? block.open;
			};
			const toggle = () => {
				if (element.open !== (cache.opened(path, owner.source).get(absoluteFrom) ?? block.open)) {
					cache.set(path, owner.source, absoluteFrom, element.open);
				}
			};
			sync(); element.addEventListener('toggle', toggle);
			const unsubscribe = cache.subscribe(path, sync);
			releaseState = () => { unsubscribe(); element.removeEventListener('toggle', toggle); };
		}
		const releaseBody = register(body, markdown);
		const releaseOwner = registerReadingDetailsOwner({ section: owner.section, source: owner.source,
			from: owner.firstLine + lineAt(block.from), to: owner.firstLine + lineAt(block.to), details: element, summary,
			blocks: readingDetailsBodyBlocks(body, markdown, firstLine) });
		releases.push(() => { releaseState(); releaseOwner(); releaseBody(); releaseNested(); body.remove(); element.append(...original); });
	}
	return () => { for (const release of releases.reverse()) release(); };
}
