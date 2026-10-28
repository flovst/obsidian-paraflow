import { createDetachedEl } from '../dom';
import type { SyntaxNode } from '@lezer/common';
import { middleBlankRows } from '../editor/paragraph/blank-rows.js';
import type { ParagraphPhysicalRow } from '../editor/paragraph/model.js';
import { detailsContainers } from '../editor/rendered-blocks/details-source.js';

interface RenderedBlock { node: SyntaxNode; element: HTMLElement; }
export { READING_BLANK_PARAGRAPH_CSS } from './blank-paragraphs-css.js';
const selectors: Readonly<Record<string, string>> = {
	Paragraph: 'p', BulletList: 'ul', OrderedList: 'ol', ListItem: 'li',
	Blockquote: 'blockquote,.callout', FencedCode: 'pre,.paraflow-code-display-frame',
	CodeBlock: 'pre,.paraflow-code-display-frame', Table: 'table,.paraflow-display-table-viewport',
	HorizontalRule: 'hr', HTMLBlock: 'details,table',
	CalloutNativeBlock: '.math-block',
};

function selector(node: SyntaxNode): string | undefined {
	return /^(?:ATXHeading[1-6]|SetextHeading[12])$/u.test(node.name) ? `h${node.name.at(-1)}` : selectors[node.name];
}
function kind(node: SyntaxNode): string {
	if (node.name === 'Paragraph') return 'p';
	if (/Heading/u.test(node.name)) return `h${node.name.at(-1)}`;
	if (node.name === 'BulletList' || node.name === 'OrderedList') return 'list-item';
	if (node.name === 'FencedCode' || node.name === 'CodeBlock') return 'code-block';
	if (node.name === 'Table') return 'table';
	if (node.name === 'Blockquote') return 'blockquote';
	if (node.name === 'CalloutNativeBlock') return 'math-block';
	return 'p';
}
function gapEdge(block: string, side: 'top' | 'bottom'): string {
	const fallback = block === 'code-block' ? '.9375em' : block === 'table'
		? side === 'top' ? '1.1em' : '1.2em' : 'var(--paraflow-block-gap,.8em)';
	return block === 'p' ? `var(--paraflow-body-paragraph-gap,var(--paraflow-p-margin-${side},var(--paraflow-block-gap,.8em)))`
		: `var(--paraflow-${block}-margin-${side},${fallback})`;
}

/** Each source section owns its extra empty paragraphs, including while detached. */
export function displayReadingBlankParagraphs(root: HTMLElement, source: string, nodes: readonly SyntaxNode[],
	before: SyntaxNode | undefined, after: SyntaxNode | undefined, leadingBoundary = 0, container = false): () => void {
	const undo: Array<() => void> = [];
	const details = detailsContainers(source);
	const end = (node: SyntaxNode): number => details.find(block => block.from <= node.from && node.from <= block.headerTo)?.to ?? node.to;
	function style(element: HTMLElement, property: string, value: string): void {
		const previous = element.style.getPropertyValue(property), priority = element.style.getPropertyPriority(property);
		element.style.setProperty(property, value, 'important');
		undo.push(() => { if (previous) element.style.setProperty(property, previous, priority); else element.style.removeProperty(property); });
	}
	function spacer(rows: readonly ParagraphPhysicalRow[], previousKind: string, nextKind: string): HTMLDivElement {
		const holder = createDetachedEl(root.ownerDocument, 'div');
		holder.className = 'paraflow-reading-blank-paragraphs';
		holder.setAttribute('aria-hidden', 'true');
		const visible = rows.filter(row => row.kind !== 'folded');
		for (const [index, row] of visible.entries()) {
			const element = createDetachedEl(root.ownerDocument, 'div');
			element.dataset.paraflowBlankRow = row.kind;
			const height = row.kind === 'editable' ? 'calc(1em * var(--paraflow-line-height,1.6))'
				: `max(${gapEdge(index === 0 ? previousKind : 'p', 'bottom')},${gapEdge(index === visible.length - 1 ? nextKind : 'p', 'top')})`;
			element.style.setProperty('--paraflow-reading-blank-height', height);
			holder.append(element);
		}
		undo.push(() => holder.remove());
		return holder;
	}
	function between(left: SyntaxNode, right: SyntaxNode): readonly ParagraphPhysicalRow[] {
		const whitespace = source.slice(end(left), right.from).replace(/^(?:[ \t]*>[ \t]?)+/gmu, '');
		if (!/^\s*$/u.test(whitespace)) return [];
		return middleBlankRows(0, (whitespace.match(/\n/gu) ?? []).length);
	}
	function hasParagraph(rows: readonly ParagraphPhysicalRow[]): boolean { return rows.some(row => row.kind === 'editable'); }
	function mapBlocks(parent: HTMLElement, children: readonly SyntaxNode[]): RenderedBlock[] {
		const elements = [...parent.children].flatMap(element => element.matches('.paraflow-reading-math-section') ? [...element.children] : [element]) as HTMLElement[];
		let index = 0;
		const result: RenderedBlock[] = [];
		for (const node of children) {
			const match = selector(node);
			if (!match) continue;
			const found = elements.findIndex((element, candidate) => candidate >= index && element.matches(match));
			if (found < 0) continue;
			result.push({ node, element: elements[found]! }); index = found + 1;
		}
		return result;
	}
	function inside(parent: HTMLElement, children: readonly SyntaxNode[]): void {
		const blocks = mapBlocks(parent, children);
		for (let index = 0; index < blocks.length; index++) {
			const current = blocks[index]!, previous = blocks[index - 1];
			// List item edges retain list rhythm; item-internal paragraphs use body rhythm.
			if (previous && current.node.name !== 'ListItem') {
				const rows = between(previous.node, current.node);
				if (hasParagraph(rows)) {
					current.element.before(spacer(rows, kind(previous.node), kind(current.node)));
					style(previous.element, 'margin-block-end', '0'); style(current.element, 'margin-block-start', '0');
				}
			}
			if (['Blockquote', 'BulletList', 'OrderedList', 'ListItem'].includes(current.node.name)) {
				const container = current.element.matches('.callout') ? current.element.querySelector<HTMLElement>(':scope > .callout-content') : current.element;
				if (!container) continue;
				const nested: SyntaxNode[] = [];
				for (let child = current.node.firstChild; child; child = child.nextSibling) nested.push(child);
				inside(container, nested);
			}
		}
	}
	if (!nodes.length) {
		if (/^\s*$/u.test(source)) {
			const rows = container ? middleBlankRows(0, source.split('\n').length - 1)
				: source.split('\n').map((_, at) => ({ at, kind: 'editable' as const }));
			if (hasParagraph(rows)) root.append(spacer(rows, 'p', 'p'));
		}
		return () => { for (const restore of undo.reverse()) restore(); };
	}
	const first = nodes[0]!, last = nodes.at(-1)!;
	if (before) {
		const rows = between(before, first);
		if (hasParagraph(rows)) { root.prepend(spacer(rows, kind(before), kind(first))); style(root, 'padding-block-start', '0'); }
	} else {
		const prefix = source.slice(leadingBoundary, first.from);
		if (/^\s*$/u.test(prefix)) {
			const count = (prefix.match(/\n/gu) ?? []).length;
			const rows: readonly ParagraphPhysicalRow[] = leadingBoundary || container ? middleBlankRows(0, count)
				: [{ at: 0, kind: 'editable' }, ...middleBlankRows(0, count)];
			if (count >= 2 && hasParagraph(rows)) root.prepend(spacer(rows, 'p', kind(first)));
		}
	}
	inside(root, nodes);
	if (!after) {
		const suffix = source.slice(end(last));
		if (/^\s*$/u.test(suffix)) {
			const count = (suffix.match(/\n/gu) ?? []).length;
			const rows: readonly ParagraphPhysicalRow[] = container ? middleBlankRows(0, count)
				: [...middleBlankRows(0, count), { at: count, kind: 'editable' }];
			if (count && hasParagraph(rows)) root.append(spacer(rows, kind(last), 'p'));
		}
	}
	return () => { for (const restore of undo.reverse()) restore(); };
}
