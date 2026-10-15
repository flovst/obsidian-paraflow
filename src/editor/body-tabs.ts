import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { EditorSelection, Prec, StateField, Transaction, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { EnhancementSettings } from '../enhancement-settings.js';
import { contentSyntaxTree, projectCallout, type CalloutProjection } from './callout/projection.js';
import { confirmedSyntaxEnd, discoverAtxHeadings, discoverParagraphAuthority } from './paragraph/syntax.js';
import type { AtxHeadingBlock } from './paragraph/model.js';
import { buildProjectionContexts } from './structured-list/context.js';
import { enumerateListItems } from './structured-list/syntax.js';
import { classifyCurrentSelectionMode } from './runtime/input-state.js';
import { literalBodyTab } from './literal-tab.js';

export type BodyTabOptions = Pick<EnhancementSettings, 'bodyTabMode' | 'bodyTabSize'>;

function specialInline(state: EditorState, position: number, to = position): boolean {
	for (const tree of [syntaxTree(state), contentSyntaxTree(state)]) {
		for (const side of [-1, 1] as const) {
			for (let node: SyntaxNode | null = tree.resolveInner(position, side); node?.parent; node = node.parent) {
				if ((to === position ? node.from < position && position < node.to : node.from < to && position < node.to) &&
					/(?:InlineCode|CodeBlock|FencedCode|HTMLTag|HTMLBlock|Table|LinkMark|URL|CalloutNative|(?:^|[ _-])(?:code|math|comment|frontmatter|yaml)(?:$|[ _-]))/iu.test(node.name)) return true;
			}
		}
	}
	return false;
}

function plainBodyStart(state: EditorState, position: number): number | null {
	const line = state.doc.lineAt(position);
	if (!syntaxTreeAvailable(state, line.to) || specialInline(state, position)) return null;
	const heading = discoverAtxHeadings(state).find(block => block.contentFrom <= position && position <= block.to);
	if (heading) return heading.contentFrom;
	const authority = discoverParagraphAuthority(state);
	const paragraph = authority.blocks.find(block => block.kind === 'paragraph' &&
		state.doc.lineAt(block.from).from <= position && position <= block.to);
	if (paragraph) return line.from;
	// Only complete authority can identify an empty ordinary row by absence.
	if (authority.complete && /^[ \t]*$/u.test(line.text) && !authority.blocks.some(block => block.from <= position && position <= block.to)) return line.from;
	return null;
}

function insertBodyTab(view: EditorView): boolean {
	const state = view.state;
	if (state.readOnly || view.composing || classifyCurrentSelectionMode(state) !== 'caret' ||
		completionOwnsTab(view)) return false;
	const caret = state.selection.main.head;
	const projection = projectCallout(state);
	const content = projection?.state ?? state;
	const position = content.selection.main.head;
	const from = plainBodyStart(content, position);
	if (from === null) return false;
	const insert = literalBodyTab(content.sliceDoc(from, position));
	view.dispatch({ changes: {from:caret, insert}, selection: EditorSelection.single(caret + insert.length),
		scrollIntoView:true, annotations:Transaction.userEvent.of('input') });
	return true;
}

function completionOwnsTab(view: EditorView): boolean {
	if (view.contentDOM.getAttribute('aria-autocomplete') === 'list' && view.contentDOM.getAttribute('aria-expanded') === 'true') return true;
	// Obsidian's native suggest popup is outside the editor and has no completion ARIA.
	return [...view.dom.ownerDocument.querySelectorAll<HTMLElement>('.suggestion-container')].some(popup =>
		popup.getClientRects().length > 0 && popup.querySelector('.suggestion > .suggestion-item.is-selected') !== null);
}

type PrefixRanges = readonly {from:number;to:number}[];

function contentTab(state: EditorState, position: number, prefixes: Map<EditorState, PrefixRanges>, headings: Map<EditorState, readonly AtxHeadingBlock[]>): boolean {
	if (specialInline(state, position, position + 1)) return false;
	let headingBlocks = headings.get(state);
	if (!headingBlocks) {
		headingBlocks = discoverAtxHeadings(state);
		headings.set(state, headingBlocks);
	}
	const heading = headingBlocks.find(heading => heading.from <= position && position < heading.to);
	if (heading) return heading.contentFrom <= position;
	let paragraph: SyntaxNode | null = null;
	for (let node: SyntaxNode | null = contentSyntaxTree(state).resolveInner(position, 1); node; node = node.parent) {
		if (node.name === 'Paragraph') paragraph = node;
		if (node.name === 'Blockquote') return false;
	}
	if (!paragraph || position < paragraph.from) return false;
	let owned = prefixes.get(state);
	if (!owned) {
		owned = buildProjectionContexts(state, enumerateListItems(state)).flatMap(list =>
			[list.block.prefix.full, ...list.ownedLines.map(line => line.prefix)]);
		prefixes.set(state, owned);
	}
	return !owned.some(prefix => prefix.from <= position && position < prefix.to);
}

function tabPositions(state: EditorState, confirmedTo: number): number[] {
	const result: number[] = [];
	const prefixes = new Map<EditorState, PrefixRanges>();
	const headings = new Map<EditorState, readonly AtxHeadingBlock[]>();
	const quotes = new Map<number, CalloutProjection>();
	for (const match of state.doc.toString().matchAll(/\t/gu)) {
		const position = match.index;
		if (state.doc.lineAt(position).to > confirmedTo) continue;
		if (specialInline(state, position, position + 1)) continue;
		let quote: SyntaxNode | null = contentSyntaxTree(state).resolveInner(position, 1);
		while (quote && quote.name !== 'Blockquote') quote = quote.parent;
		if (!quote) {
			if (contentTab(state, position, prefixes, headings)) result.push(position);
			continue;
		}
		let projection = quotes.get(quote.from);
		if (!projection) {
			const discovered = projectCallout(state, EditorSelection.cursor(position));
			if (!discovered) continue;
			projection = discovered; quotes.set(quote.from, projection);
		}
		const line = projection.lines[state.doc.lineAt(position).number - state.doc.lineAt(projection.lines[0]!.from).number];
		if (!line || position < line.from + line.prefix.length) continue;
		const virtual = line.virtualFrom + position - line.from - line.prefix.length;
		if (contentTab(projection.state, virtual, prefixes, headings)) result.push(position);
	}
	return result;
}

export function createBodyTabExtension(isActive: (view: EditorView) => boolean, getOptions: () => BodyTabOptions): Extension {
	function build(state: EditorState) {
		const options = getOptions();
		const confirmedTo = confirmedSyntaxEnd(state);
		const decorations = tabPositions(state, confirmedTo).map(position => Decoration.mark({class:'paraflow-body-tab',attributes:{
			'data-paraflow-tab':String(position),
			style:`display:${options.bodyTabMode === 'fixed' ? 'inline-block' : 'inline'};white-space:pre;tab-size:${options.bodyTabSize}`,
		}}).range(position,position+1));
		return {tree:syntaxTree(state), confirmedTo, options:{...options}, decorations:Decoration.set(decorations,true)};
	}
	const field=StateField.define({create:build,update(value,tr){
		const options=getOptions();
		return tr.docChanged || tr.reconfigured || value.tree!==syntaxTree(tr.state) || value.confirmedTo!==confirmedSyntaxEnd(tr.state) || options.bodyTabMode!==value.options.bodyTabMode || options.bodyTabSize!==value.options.bodyTabSize ? build(tr.state) : value;
	}});
	return [field,EditorView.decorations.of(view=>isActive(view)?view.state.field(field).decorations:Decoration.none),
		Prec.high(keymap.of([{key:'Tab',run:view=>isActive(view) && insertBodyTab(view)}]))];
}
