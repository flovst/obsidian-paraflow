import { EditorState, type Text } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';
import { quotePrefix } from './projection.js';
import { metadataGrammar, nativeInlineGrammarFor } from '../markdown-grammar.js';
import { mathRangeIndex } from '../math/syntax.js';
import {quoteDraftMasks,maskQuoteDraftSource} from './quote-draft.js';
import {codeDraft} from '../code-blocks/draft-state.js';
import {codeDraftMask,maskCodeSource} from '../code-blocks/parser-source.js';
import { containerSourceContext, sameContainerSource } from './source-context.js';

export interface CalloutTextBlock {
	readonly tag: string;
	readonly text: string;
	readonly positions: readonly number[];
	readonly entities: readonly { readonly from: number; readonly to: number }[];
}
export interface CalloutCard {
	readonly kind: 'quote' | 'callout';
	readonly from: number;
	readonly to: number;
	readonly headerTo: number;
	readonly depth: number;
	readonly listDepth?: number;
	readonly listTask?: boolean;
	readonly listOrderedTask?: boolean;
	readonly type: string;
	readonly metadata: string;
	readonly fold: string;
	readonly header: string;
	readonly blocks: readonly CalloutTextBlock[];
}
const grammar = parser.configure([GFM, metadataGrammar]);
const cache = new WeakMap<EditorState, readonly CalloutCard[]>();
// Only the latest semantic variant is retained per Text; exact-state results remain independent.
const sourceCache = new WeakMap<Text, { context: ReturnType<typeof containerSourceContext>; cards: readonly CalloutCard[] }>();
const noQuoteDocuments = new WeakSet<Text>();
const noCards: readonly CalloutCard[] = [];

function visibleBlock(state: EditorState, node: SyntaxNode, card: Pick<CalloutCard, 'headerTo' | 'depth'>): CalloutTextBlock | null {
	const from = Math.max(node.from, card.headerTo + 1);
	const to = /^SetextHeading/u.test(node.name) ? state.doc.line(state.doc.lineAt(node.to).number - 1).to : node.to;
	if (from >= to) return null;
	const hidden = new Set<number>();
	const entities: { from: number; to: number }[] = [];
	const cursor = node.cursor();
	do {
		if (cursor.name === 'Entity') entities.push({ from: cursor.from, to: cursor.to });
		if (/^(?:QuoteMark|ListMark|TaskMarker|EmphasisMark|StrikethroughMark|CodeMark|LinkMark|URL|LinkTitle|HeaderMark)$/u.test(cursor.name)) {
			for (let position = cursor.from; position < cursor.to; position += 1) hidden.add(position);
		}
	} while (cursor.next() && cursor.from < node.to);
	for (let number = state.doc.lineAt(from).number; number <= state.doc.lineAt(node.to).number; number += 1) {
		const line = state.doc.line(number);
		const prefix = quotePrefix(line.text, card.depth);
		if (prefix) for (let position = line.from; position < line.from + prefix.length; position += 1) hidden.add(position);
	}
	let text = '';
	const positions: number[] = [];
	for (let position = from; position < to; position += 1) {
		if (hidden.has(position)) continue;
		const char = state.sliceDoc(position, position + 1);
		if (char === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/u.test(state.sliceDoc(position + 1, position + 2))) continue;
		if (/\s/u.test(char)) {
			if (!text || text.endsWith(' ')) continue;
			text += ' '; positions.push(position);
		} else { text += char; positions.push(position); }
	}
	if (text.endsWith(' ')) { text = text.slice(0, -1); positions.pop(); }
	positions.push(to);
	return { tag: node.parent?.name === 'ListItem' ? 'li' : /^(?:ATXHeading|SetextHeading)/u.test(node.name) ? `h${node.name.slice(-1)}` : 'p', text, positions, entities };
}

export function calloutTitleFrom(card: CalloutCard): number {
	const metadata = /^\[![^\]]+\][+-]?[ \t]*/u.exec(card.header)!;
	return card.headerTo - card.header.length + metadata[0].length;
}

/** Uses the same inline source mapping as body entry, without title metadata. */
export function calloutTitleBlock(state: EditorState, card: CalloutCard): CalloutTextBlock | null {
	const from = calloutTitleFrom(card);
	if (from === card.headerTo) return null;
	const title = EditorState.create({ doc: state.sliceDoc(from, card.headerTo) });
	const block = visibleBlock(title, grammar.configure(nativeInlineGrammarFor(mathRangeIndex(title).expressions)).parse(title.doc.toString()).topNode, { headerTo: -1, depth: 0 })!;
	return { ...block, positions: block.positions.map(position => position + from),
		entities: block.entities.map(entity => ({ from: entity.from + from, to: entity.to + from })) };
}

export function decodeCalloutBlock(block: CalloutTextBlock, decode: (entity: string) => string): Pick<CalloutTextBlock, 'text' | 'positions'> {
	if (!block.entities.length) return block;
	let text = '';
	const positions: number[] = [];
	for (let index = 0; index < block.text.length; index += 1) {
		const entity = block.entities.find(entity => entity.from === block.positions[index]);
		const end = entity ? block.positions.findIndex((position, next) => next > index && position >= entity.to) : index + 1;
		const value = entity ? decode(block.text.slice(index, end)) : block.text[index]!;
		for (let offset = 0; offset < value.length; offset += 1) {
			const char = /\s/u.test(value[offset]!) ? ' ' : value[offset]!;
			if (char === ' ' && (!text || text.endsWith(' '))) continue;
			text += char; positions.push(block.positions[index]!);
		}
		if (entity) index = end - 1;
	}
	if (text.endsWith(' ')) { text = text.slice(0, -1); positions.pop(); }
	positions.push(block.positions[block.positions.length - 1]!);
	return { text, positions };
}

/** Native cards render entire quote nodes. This index retains source positions for their ordinary text blocks. */
export function quoteContainers(state: EditorState): readonly CalloutCard[] {
	const previous = cache.get(state);
	if (previous) return previous;
	if (noQuoteDocuments.has(state.doc)) { cache.set(state, noCards); return noCards; }
	const shared = sourceCache.get(state.doc);
	let source: string | undefined;
	if (!shared) {
		source = state.doc.toString();
		if (!source.includes('>')) { noQuoteDocuments.add(state.doc); cache.set(state, noCards); return noCards; }
	}
	const context = containerSourceContext(state);
	if (shared && sameContainerSource(shared.context, context)) {
		cache.set(state, shared.cards);
		return shared.cards;
	}
	source ??= state.doc.toString();
	const cards: CalloutCard[] = [];
	const tree = grammar.configure(nativeInlineGrammarFor(mathRangeIndex(state).expressions)).parse(maskQuoteDraftSource(maskCodeSource(source,codeDraftMask(source,state.facet(codeDraft))),state.facet(quoteDraftMasks)));
	tree.iterate({ enter(ref) {
		if (ref.name !== 'Blockquote') return;
		let depth = 0, listDepth = 0, listTask = false, listOrderedTask = false;
		for (let parent: SyntaxNode | null = ref.node; parent; parent = parent.parent) {
			if (parent.name === 'Blockquote') depth += 1;
			if (parent.name === 'ListItem') {
				if (!listDepth) {
					listTask = /^(?:[-+*]|\d+[.)])[ \t]+\[[ xX]\]/u.test(state.sliceDoc(parent.from));
					listOrderedTask = /^\d+[.)][ \t]+\[[ xX]\]/u.test(state.sliceDoc(parent.from));
				}
				listDepth++;
			}
		}
		const line = state.doc.lineAt(ref.from);
		const prefix = quotePrefix(line.text, depth);
		if (prefix === null) return;
		const match = /^\[!([^\]|]+)(?:\|([^\]]*))?\]([+-]?)(?:\s|$)/u.exec(line.text.slice(prefix.length));
		const card: Omit<CalloutCard, 'blocks'> = { kind: match ? 'callout' : 'quote', from: line.from, to: ref.to,
			headerTo: match ? line.to : line.from - 1, depth, listDepth, listTask, ...(listOrderedTask ? {listOrderedTask} : {}),
			type: match?.[1]?.toLowerCase() ?? '', metadata: match?.[2] ?? '', fold: match?.[3] ?? '', header: match ? line.text.slice(prefix.length) : '' };
		const blocks: CalloutTextBlock[] = [];
		function collect(parent: SyntaxNode): void {
			for (let child = parent.firstChild; child; child = child.nextSibling) {
				if (child.name === 'Blockquote' && /^>\s*\[!/u.test(state.sliceDoc(child.from, state.doc.lineAt(child.from).to))) continue;
				if (child.name === 'Paragraph' || child.name === 'Task' || /^(?:ATXHeading|SetextHeading)/u.test(child.name)) {
					const block = visibleBlock(state, child, card);
					if (block) blocks.push(block);
				} else collect(child);
			}
		}
		collect(ref.node);
		cards.push({ ...card, blocks });
	} });
	cache.set(state, cards);
	sourceCache.set(state.doc, { context, cards });
	return cards;
}

export function calloutCards(state: EditorState): readonly CalloutCard[] {
	return quoteContainers(state).filter(card => card.kind === 'callout');
}
