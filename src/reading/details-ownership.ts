export interface ReadingDetailsBlock { from: number; to: number; element: HTMLElement; }
export interface ReadingDetailsOwner {
	section: HTMLElement;
	source: string;
	from: number;
	to: number;
	details: HTMLDetailsElement;
	summary: HTMLElement;
	blocks: readonly ReadingDetailsBlock[];
}
export interface ReadingDetailsTarget { section: HTMLElement; element: HTMLElement; line: number; }

const owners = new WeakMap<HTMLElement, Set<ReadingDetailsOwner>>();

/** Match the Markdown renderer's body blocks while retaining full-document source lines. */
export function readingDetailsBodyBlocks(body: HTMLElement, source: string, firstLine: number): ReadingDetailsBlock[] {
	const details = detailsContainers(source);
	const outer = details.filter(block => !details.some(parent => parent.from < block.from && block.to <= parent.to));
	let normalized = source;
	for (const block of [...outer].reverse()) normalized = normalized.slice(0, block.from) +
		normalized.slice(block.from, block.to).replace(/[^\r\n]/g, ' ') + normalized.slice(block.to);
	const math = scanMathRanges(normalized).expressions;
	const tree = parser.configure([GFM, metadataGrammar, standaloneBreakGrammar, nativeInlineGrammarFor(math)]).parse(normalized);
	const blocks: { from: number; to: number; selector: string }[] = outer.map(block => ({ from: block.from, to: block.to, selector: 'details' }));
	for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
		const selector = /^(?:ATXHeading[1-6]|SetextHeading[12])$/u.test(node.name) ? `h${node.name.at(-1)}` : ({
			Paragraph: 'p', BulletList: 'ul', OrderedList: 'ol', Blockquote: 'blockquote,.callout',
			FencedCode: 'pre,.paraflow-code-display-frame,.mermaid', CodeBlock: 'pre,.paraflow-code-display-frame',
			Table: 'table,.paraflow-display-table-viewport', HorizontalRule: 'hr', HTMLBlock: 'details,table,div', CalloutNativeBlock: '.math-block',
		} as Record<string, string>)[node.name];
		if (selector) blocks.push({ from: node.from, to: node.to, selector });
	}
	const elements = [...body.children].filter(element => !element.matches('.paraflow-reading-blank-paragraphs')) as HTMLElement[];
	const result: ReadingDetailsBlock[] = [];
	let next = 0;
	for (const block of blocks.sort((a, b) => a.from - b.from)) {
		const found = elements.findIndex((element, index) => index >= next &&
			(element.matches(block.selector) || element.className.startsWith('el-') && element.querySelector(block.selector)));
		if (found < 0) continue;
		result.push({ from: firstLine + source.slice(0, block.from).split('\n').length - 1,
			to: firstLine + source.slice(0, block.to).split('\n').length - 1, element: elements[found]! });
		next = found + 1;
	}
	return result;
}

/** Source ranges belong to the rendered disclosure, including hidden native continuation sections. */
export function registerReadingDetailsOwner(owner: ReadingDetailsOwner): () => void {
	let entries = owners.get(owner.section);
	if (!entries) owners.set(owner.section, entries = new Set());
	entries.add(owner);
	return () => { entries.delete(owner); if (!entries.size) owners.delete(owner.section); };
}

export function readingDetailsTargets(section: HTMLElement, source: string): ReadingDetailsTarget[] {
	const entries = [...(owners.get(section) ?? [])].filter(owner => owner.source === source);
	const targets: ReadingDetailsTarget[] = [];
	for (const owner of entries) {
		if (entries.some(parent => parent !== owner && parent.details.contains(owner.details) && !parent.details.open)) continue;
		targets.push({ section, element: owner.summary, line: owner.from });
		if (!owner.details.open) continue;
		for (const block of owner.blocks) {
			if (entries.some(child => child !== owner && owner.details.contains(child.details) &&
				child.from <= block.from && block.from <= child.to)) continue;
			targets.push({ section, element: block.element, line: block.from });
		}
	}
	return targets.sort((a, b) => a.line - b.line);
}

export function resolveReadingDetailsTarget(section: HTMLElement, source: string, line: number): ReadingDetailsTarget | null {
	const matching = [...(owners.get(section) ?? [])].filter(owner => owner.source === source && owner.from <= line && line <= owner.to)
		.sort((a, b) => a.from - b.from || b.to - a.to);
	if (!matching.length) return null;
	const owner = matching.find(entry => !entry.details.open) ?? matching.at(-1)!;
	if (!owner.details.open) return { section, element: owner.summary, line: owner.from };
	const block = owner.blocks.find(block => block.from <= line && line <= block.to)
		?? owner.blocks.filter(block => block.from <= line).at(-1);
	return { section, element: block?.element ?? owner.summary, line: block?.from ?? owner.from };
}
import { GFM, parser } from '@lezer/markdown';
import { metadataGrammar, nativeInlineGrammarFor, standaloneBreakGrammar } from '../editor/markdown-grammar.js';
import { scanMathRanges } from '../editor/math/range-scanner.js';
import { detailsContainers } from '../editor/rendered-blocks/details-source.js';
