import { pendingMath, pendingMathAt, pendingMathRanges, type PendingMathRange } from '../math/candidate-ranges.js';
import { defineLanguageFacet, ensureSyntaxTree, Language, languageDataProp, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, Facet, type Text } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';
import { paragraphProjectionField } from '../paragraph/projection.js';
import {emptyBodies,emptyBodyState,createdBodyOwnership,createdBodyOwnershipState} from '../runtime/empty-body-state.js';
import { containerListGrammar, metadataGrammar, nativeInlineGrammarFor } from '../markdown-grammar.js';
import { hasNativeOwnership } from './syntax.js';
import { mathSyntaxTree } from '../math/semantic-tree.js';
import { mathRangeIndex } from '../math/syntax.js';
import { quoteDraftMasks, maskQuoteDraftSource } from './quote-draft.js';
import { scanMathRanges } from '../math/range-scanner.js';
import { codeDraft, type CodeDraft } from '../code-blocks/draft-state.js';
import { codeDraftMask, codeDraftParser, maskCodeSource } from '../code-blocks/parser-source.js';
import {quotePrefix} from './prefix.js';
import {quotedTabStarts} from './body-tab-source.js';
import {bodyTabParser} from './body-tab-parser.js';
export {quotePrefix} from './prefix.js';

const languageData = defineLanguageFacet();
const grammar = parser.configure([GFM, containerListGrammar, {
	props: [languageDataProp.add((node) => node.isTop ? languageData : undefined)],
}]);
const documentGrammar = grammar.configure(metadataGrammar);
const trees = new WeakMap<Text, { ranges: readonly PendingMathRange[]; draft: CodeDraft | null; quotes: readonly PendingMathRange[]; tree: Tree }>();
const paragraphTabs = new WeakMap<Text, readonly number[]>();
const projectedContent=Facet.define<boolean,boolean>({combine:values=>values.some(Boolean)});

interface ProjectedLine {
	readonly from: number;
	readonly prefix: string;
	readonly virtualFrom: number;
	readonly text: string;
}

export interface CalloutProjection {
	readonly state: EditorState;
	readonly lines: readonly ProjectedLine[];
	readonly depth: number;
	readonly end: number;
	toSource(position: number): number;
}

/** A selection-independent content view used by the shared list presentation. */
export function projectQuoteContent(state: EditorState, from: number, to: number, depth: number): CalloutProjection | null {
	if (from > to) return null;
	const first = state.doc.lineAt(from).number;
	const last = state.doc.lineAt(to).number;
	const lines: ProjectedLine[] = [];
	let virtualFrom = 0;
	for (let number = first; number <= last; number += 1) {
		const line = state.doc.line(number);
		let prefix = quotePrefix(line.text, depth);
		if (prefix === null) {
			const container = containerAt(state, line.from);
			if (!container || quoteDepth(container) < depth) return null;
			// A parser-proven lazy continuation may omit some or all ancestor markers.
			for (let partial = depth - 1; partial >= 0 && prefix === null; partial -= 1) prefix = quotePrefix(line.text, partial);
		}
		if (prefix === null) throw new Error('A proven quote continuation must have a source prefix');
		const text = line.text.slice(prefix.length);
		lines.push({ from: line.from, prefix, text, virtualFrom });
		virtualFrom += text.length + 1;
	}
	const drafts=emptyBodies(state).flatMap(anchor=>{
		const line=lines.find(line=>line.from<=anchor&&anchor<=line.from+line.prefix.length+line.text.length);
		return line?[line.virtualFrom+anchor-line.from-line.prefix.length]:[];
	});
	const toVirtual = (position: number): number => {
		const line = lines.find(line => line.from <= position && position <= line.from + line.prefix.length + line.text.length)!;
		return line.virtualFrom + Math.max(0, position - line.from - line.prefix.length);
	};
	const pending = pendingMathRanges(state).filter(range => range.from <= to && range.to >= from)
		.map(range => ({ from: toVirtual(Math.max(from, range.from)), to: toVirtual(Math.min(to, range.to)) }));
	const source = lines.map(line => line.text).join('\n');
	const sourceDraft = state.facet(codeDraft);
	const draft = sourceDraft && from <= sourceDraft.from && sourceDraft.from <= to ? {
		...sourceDraft, from: toVirtual(sourceDraft.from), to: toVirtual(Math.min(to, sourceDraft.to)), end: source.length,
	} : null;
	const quotes = state.facet(quoteDraftMasks).filter(range => from <= range.from && range.to <= to).flatMap(range => {
		const line = lines.find(line => line.from <= range.from && range.from <= line.from + line.prefix.length + line.text.length)!;
		return range.from < line.from + line.prefix.length ? [] : [{ from: toVirtual(range.from), to: toVirtual(range.to) }];
	});
	let tabs=paragraphTabs.get(state.doc);
	if(!tabs){const found=quotedTabStarts(state.sliceDoc());tabs=[...found.paragraphs,...found.blocks].sort((a,b)=>a-b);paragraphTabs.set(state.doc,tabs);}
	const tabMasks=tabs.filter(at=>from<=at&&at<=to).map(at=>({from:toVirtual(at),to:toVirtual(at)+1,fill:' ' as const}));
	const masks = [...codeDraftMask(source, draft), ...quotes,...tabMasks].sort((a, b) => a.from - b.from);
	const normalized = maskCodeSource(source, masks);
	const projectedLanguage = new Language(languageData, bodyTabParser(codeDraftParser(grammar.configure(nativeInlineGrammarFor(scanMathRanges(normalized).expressions, pending)), masks),tabMasks.map(mask=>mask.from)), [], 'paraflow-callout-content');
	const virtual = EditorState.create({ doc: source, extensions: [projectedLanguage,projectedContent.of(true),pendingMath.of(pending),codeDraft.of(draft),quoteDraftMasks.of(quotes),
		emptyBodyState.init(()=>drafts),createdBodyOwnershipState.init(()=>createdBodyOwnership(state).flatMap(body => {
            const line=lines.find(line=>line.from===body.lineFrom);
            if(!line)return [];
            const owner=body.ownerFrom===null?null:lines.find(line=>line.from===body.ownerFrom);
            return [{...body,lineFrom:line.virtualFrom,bodyFrom:toVirtual(body.bodyFrom),prefix:body.prefix.slice(line.prefix.length),
                ...(body.maintenanceFrom===undefined?{}:{maintenanceFrom:toVirtual(body.maintenanceFrom)}),
                ownerFrom:owner?.virtualFrom??null,ownerPrefix:owner?body.ownerPrefix.slice(owner.prefix.length):''}];
        })),paragraphProjectionField] });
	ensureSyntaxTree(virtual, virtual.doc.length, Infinity);
	// Publish the completed parse context before consumers read syntaxTree(state).
	const parsed = virtual.update({}).state;
	return {
		depth, end: to, lines, state: parsed,
		toSource(position) {
			const line = virtual.doc.lineAt(position);
			const projected = lines[line.number - 1]!;
			return projected.from + projected.prefix.length + position - line.from;
		},
	};
}

function quoteDepth(node: SyntaxNode): number {
	let depth = 0;
	for (let current: SyntaxNode | null = node; current; current = current.parent) {
		if (current.name === 'Blockquote') depth += 1;
	}
	return depth;
}

function isCallout(node: SyntaxNode, state: EditorState): boolean {
	if (node.name !== 'Blockquote') return false;
	const text = state.doc.lineAt(node.from).text;
	const prefix = quotePrefix(text, quoteDepth(node));
	return prefix !== null && /^\[![^\]\r\n]+\][+-]?(?:\s|$)/u.test(text.slice(prefix.length));
}

export function contentSyntaxTree(state: EditorState): Tree {
	if(state.facet(projectedContent))return syntaxTree(state);
	const pending = pendingMathRanges(state), draft = state.facet(codeDraft), quotes = state.facet(quoteDraftMasks), cached = trees.get(state.doc);
	if (cached?.ranges === pending && cached.draft === draft && cached.quotes === quotes) return cached.tree;
	const source = state.doc.toString();
	const tree = documentGrammar.configure(nativeInlineGrammarFor(mathRangeIndex(state).expressions, pending)).parse(maskQuoteDraftSource(maskCodeSource(source, codeDraftMask(source, draft)), quotes));
	trees.set(state.doc, { ranges: pending, draft, quotes, tree });
	return tree;
}

function containerAt(state: EditorState, position: number): SyntaxNode | null {
	const tree = contentSyntaxTree(state);
	const candidate: { node: SyntaxNode | null } = { node: null };
	tree.iterate({ enter(node) {
		if (node.from > position || node.to < position) return false;
		if (node.name === 'Blockquote') candidate.node = node.node;
		return undefined;
	} });
	if (!candidate.node) return null;
	for (let node: SyntaxNode | null = candidate.node; node; node = node.parent) {
		if (node.name === 'ListItem' && state.doc.lineAt(node.from).number === state.doc.lineAt(candidate.node.from).number) return null;
	}
	return candidate.node;
}

/** Only the proven quote container is projected; native syntax and geometry stay intact. */
export function projectCallout(state: EditorState, selection = state.selection.main): CalloutProjection | null {
	const container = containerAt(state, selection.head);
	if (!container) return null;
	const depth = quoteDepth(container);
	const first = state.doc.lineAt(container.from).number + (isCallout(container, state) ? 1 : 0);
	const last = state.doc.lineAt(container.to).number;
	if (first > last) return null;
	const projection = projectQuoteContent(state, state.doc.line(first).from, state.doc.line(last).to, depth);
	if (!projection) return null;
	function toVirtual(position: number): number | null {
		const line = projection!.lines.find((line) => line.from + line.prefix.length <= position &&
			position <= line.from + line.prefix.length + line.text.length);
		return line ? line.virtualFrom + position - line.from - line.prefix.length : null;
	}
	const anchor = toVirtual(selection.anchor);
	const head = toVirtual(selection.head);
	if (anchor === null || head === null) return null;
	if (!pendingMathAt(state, selection.from, selection.to) && hasNativeOwnership(mathSyntaxTree(projection.state),Math.min(anchor,head),Math.max(anchor,head))) return null;
	const mappedSelection = selection.empty
		? EditorSelection.cursor(head, selection.assoc, selection.bidiLevel ?? undefined, selection.goalColumn)
		: EditorSelection.range(anchor, head, selection.goalColumn, selection.bidiLevel ?? undefined);
	return { ...projection, state: projection.state.update({ selection: EditorSelection.create([mappedSelection]) }).state };
}
