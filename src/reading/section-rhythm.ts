import { GFM, parser } from '@lezer/markdown';
import { metadataGrammar, nativeInlineGrammarFor, standaloneBreakGrammar } from '../editor/markdown-grammar.js';
import { scanMathRanges } from '../editor/math/range-scanner.js';
import type { SyntaxNode } from '@lezer/common';
import { displayReadingBlankParagraphs } from './blank-paragraphs.js';
import { detailsContainers } from '../editor/rendered-blocks/details-source.js';

export interface ReadingSectionSource { text: string; lineStart: number; lineEnd: number; container?: boolean; }
interface Block { from: number; to: number; kind: string; node: SyntaxNode; }

/** A recycled section keeps its source neighbours even when they are not mounted. */
export function createReadingSectionRhythm() {
	let cachedSource: string | null = null;
	let blocks: readonly Block[] = [];
	let leadingBoundary = 0;
	return (root: HTMLElement, section: ReadingSectionSource | null, showBlankParagraphs = false): (() => void) => {
		if (!section) return () => {};
		if (cachedSource !== section.text) {
			cachedSource = section.text;
			const source = section.text, math = scanMathRanges(source).expressions;
			const tree = parser.configure([GFM, metadataGrammar, standaloneBreakGrammar, nativeInlineGrammarFor(math)]).parse(source);
			const next: Block[] = [];
			const details = detailsContainers(source);
			const outerDetails = details.filter(block => !details.some(parent => parent.from < block.from && block.to <= parent.to));
			const seenDetails = new Set<number>();
			leadingBoundary = 0;
			for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
				let kind: string;
				const detail = outerDetails.find(block => block.from <= node.from && node.from < block.to);
				if (detail) {
					if (!seenDetails.has(detail.from)) next.push({ from: source.slice(0, detail.from).split('\n').length - 1,
						to: source.slice(0, detail.to).split('\n').length - 1, kind: 'html-block', node });
					seenDetails.add(detail.from); continue;
				}
				if (node.name === 'CalloutNativeMetadata' || node.name === 'LinkReference') {
					if (!next.length) leadingBoundary = node.to;
					continue;
				}
				if (node.name === 'CalloutNativeBlock') {
					if (!math.some(expression => expression.display && expression.from === node.from)) continue;
					kind = 'math-block';
				} else if (/^(?:ATXHeading[1-6]|SetextHeading[12])$/u.test(node.name)) kind = `h${node.name.at(-1)}`;
				else if (node.name === 'BulletList' || node.name === 'OrderedList') kind = 'list-item';
				else if (node.name === 'Blockquote') kind = 'blockquote';
				else if (node.name === 'FencedCode' || node.name === 'CodeBlock') kind = 'code-block';
				else if (node.name === 'Table' || node.name === 'HTMLBlock' && /^<table(?:\s|>)/iu.test(source.slice(node.from))) kind = 'table';
				else if (node.name === 'HorizontalRule') kind = 'thematic-break';
				else kind = node.name === 'Paragraph' && node.firstChild?.name === 'Image' && node.firstChild.from === node.from && node.firstChild.to === node.to ? 'media' : 'p';
				next.push({ from: source.slice(0, node.from).split('\n').length - 1,
					to: source.slice(0, node.to).split('\n').length - 1, kind, node });
			}
			blocks = next;
		}
		const index = blocks.findIndex(block => block.from <= section.lineEnd && block.to >= section.lineStart);
		if (index < 0) return showBlankParagraphs && !blocks.length
			? displayReadingBlankParagraphs(root, section.text, [], undefined, undefined, 0, section.container) : () => {};
		const attrs = {
			'data-paraflow-reading-kind': blocks[index]!.kind,
			'data-paraflow-reading-before': blocks[index - 1]?.kind ?? '',
			'data-paraflow-reading-after': blocks[index + 1]?.kind ?? '',
		};
		const previous = Object.keys(attrs).map(name => [name, root.getAttribute(name)] as const);
		for (const [name, value] of Object.entries(attrs)) root.setAttribute(name, value);
		const selected = blocks.filter(block => block.from <= section.lineEnd && block.to >= section.lineStart);
		const releaseBlanks = showBlankParagraphs ? displayReadingBlankParagraphs(root, section.text,
			selected.map(block => block.node), blocks[index - 1]?.node, blocks[index + selected.length]?.node, leadingBoundary, section.container) : () => {};
		return () => { releaseBlanks(); for (const [name, value] of previous) {
			if (value === null) root.removeAttribute(name); else root.setAttribute(name, value);
		} };
	};
}
