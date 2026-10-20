import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { ChangeSet, EditorSelection, EditorState, Prec, StateField, Transaction, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { isolateHistory } from '@codemirror/commands';
import type { EnhancementSettings } from '../enhancement-settings.js';
import { contentSyntaxTree, projectCallout, type CalloutProjection } from './callout/projection.js';
import { confirmedSyntaxEnd, discoverAtxHeadings, discoverParagraphAuthority } from './paragraph/syntax.js';
import type { AtxHeadingBlock } from './paragraph/model.js';
import { buildProjectionContexts } from './structured-list/context.js';
import { enumerateListItems } from './structured-list/syntax.js';
import { classifyCurrentSelectionMode, compositionStateField, excludedSelectionModeForTransaction, recognizedNormalSelectionTransaction } from './runtime/input-state.js';
import { bodyTabDelimiterOffset, literalBodyTab } from './literal-tab.js';
import {quotePrefix} from './callout/prefix.js';

export type BodyTabOptions = Pick<EnhancementSettings, 'bodyTabMode' | 'bodyTabSize'>;

/** Project first: a quoted HTML block can overrun its closing tag in the host tree. */
function bodyProjection(state: EditorState, position: number): CalloutProjection | null {
	return projectCallout(state,EditorSelection.cursor(position));
}

function originalParagraphTab(state: EditorState, position: number): boolean {
	const text = state.sliceDoc(position,state.doc.lineAt(position).to);
	const content = position + (/^[ \t]*/u.exec(text)![0].length);
	for (let node: SyntaxNode | null = contentSyntaxTree(state).resolveInner(content, 1); node; node = node.parent) {
		if (node.name === 'Paragraph') {
			for(let parent=node.parent;parent&&parent.name!=='Blockquote';parent=parent.parent)if(parent.name==='ListItem')return false;
			return true;
		}
		if (/CodeBlock|FencedCode|InlineCode/u.test(node.name)) return false;
	}
	return false;
}

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

export function insertBodyTab(view: EditorView): boolean {
	const state = view.state;
	if (state.readOnly || view.composing || classifyCurrentSelectionMode(state) !== 'caret' ||
		completionOwnsTab(view)) return false;
	const caret = state.selection.main.head;
	const projection = bodyProjection(state, caret);
	const content = projection?.state ?? state;
	const position = content.selection.main.head;
	// Removing a quote prefix changes Tab stops; preserve the original paragraph owner.
	const from = plainBodyStart(content, position) ?? (projection && originalParagraphTab(state,caret) && !specialInline(state,caret) ? content.doc.lineAt(position).from : null);
	if (from === null) return false;
	const line=content.doc.lineAt(position),body=content.sliceDoc(from,line.to);
	const leading=/^[ \t]*(?:\u200b(?=[ \t]*\t)[ \t]*)?/u.exec(body)![0];
	if(position<=from+leading.length&&leading.includes('\t')){
		const anchor=bodyTabDelimiterOffset(body),sourceFrom=projection?.toSource(from)??from;
		const clean=leading.replace('\u200b',''),offset=position-from-(anchor!==null&&position>from+anchor?1:0);
		const insert='\u200b'+clean.slice(0,offset)+'\t'+clean.slice(offset);
		view.dispatch({changes:{from:sourceFrom,to:sourceFrom+leading.length,insert},selection:EditorSelection.cursor(sourceFrom+offset+2),scrollIntoView:true,userEvent:'input'});
		return true;
	}
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

/** Only a proven ordinary-body start owns the formatting delimiter inserted with leading tabs. */
interface BodyDelimiter { readonly at:number; readonly bodyFrom:number }
function bodyDelimiters(state: EditorState): BodyDelimiter[] {
	return [...state.doc.toString().matchAll(/\u200b/gu)].flatMap(match => {
		const position = match.index;
		const projection = bodyProjection(state, position);
		const content = projection?.state ?? state;
		const at = projection ? content.selection.main.head : position;
		const from=plainBodyStart(content,at);
		if(from===null || bodyTabDelimiterOffset(content.sliceDoc(from,content.doc.lineAt(at).to))!==at-from)return [];
		return [{at:position,bodyFrom:projection?.toSource(from)??from}];
	});
}

type PrefixRanges = readonly {from:number;to:number}[];

function contentTab(state: EditorState, position: number, prefixes: Map<EditorState, PrefixRanges>, headings: Map<EditorState, readonly AtxHeadingBlock[]>): boolean {
	if (specialInline(state, position, position + 1)) return false;
	// Blank body rows have no Paragraph node, but still own their literal Tab width.
	if (/^[ \t]*$/u.test(state.doc.lineAt(position).text) && plainBodyStart(state, position) !== null) return true;
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
		let quote: SyntaxNode | null = contentSyntaxTree(state).resolveInner(position, 1);
		while (quote && quote.name !== 'Blockquote') quote = quote.parent;
		if (!quote) {
			if (contentTab(state, position, prefixes, headings)) result.push(position);
			continue;
		}
		let projection = quotes.get(quote.from);
		if (!projection) {
			const discovered = bodyProjection(state, position);
			if (!discovered) continue;
			projection = discovered; quotes.set(quote.from, projection);
		}
		const line = projection.lines[state.doc.lineAt(position).number - state.doc.lineAt(projection.lines[0]!.from).number];
		if (!line || position < line.from + line.prefix.length) continue;
		const virtual = line.virtualFrom + position - line.from - line.prefix.length;
		if (contentTab(projection.state, virtual, prefixes, headings) ||
			/^[ \t]*$/u.test(line.text.slice(0,virtual-line.virtualFrom)) && !specialInline(state,position,position+1) && originalParagraphTab(state,position)) result.push(position);
	}
	return result;
}

export function createBodyTabExtension(isActive: (view: EditorView) => boolean, getOptions: () => BodyTabOptions): Extension {
	function build(state: EditorState) {
		const options = getOptions();
		const confirmedTo = confirmedSyntaxEnd(state);
		const positions=tabPositions(state,confirmedTo);
		const decorations = positions.map(position => Decoration.mark({class:'paraflow-body-tab',attributes:{
			'data-paraflow-tab':String(position),
			style:`display:${options.bodyTabMode === 'fixed' ? 'inline-block' : 'inline'};white-space:pre;tab-size:${options.bodyTabSize}`,
		}}).range(position,position+1));
		const delimiters = bodyDelimiters(state);
		const leading=positions.flatMap(at=>{
			const projection=bodyProjection(state,at),content=projection?.state??state,position=projection?content.selection.main.head:at;
			const from=plainBodyStart(content,position);if(from===null)return [];
			const text=content.sliceDoc(from,content.doc.lineAt(position).to),run=/^[ \t]*(?:\u200b(?=[ \t]*\t)[ \t]*)?/u.exec(text)![0];
			const sourceFrom=projection?.toSource(from)??from;
			return position<from+run.length?[{from:sourceFrom,to:sourceFrom+run.length,depth:projection?.depth??0}]:[];
		}).filter((run,index,runs)=>runs.findIndex(other=>other.from===run.from)===index);
		return {tree:syntaxTree(state), confirmedTo, options:{...options}, delimiters,leading,
			decorations:Decoration.set([...decorations,...delimiters.map(({at})=>Decoration.replace({}).range(at,at+1))],true)};
	}
	const field=StateField.define({create:build,update(value,tr){
		const options=getOptions();
		return tr.docChanged || tr.reconfigured || value.tree!==syntaxTree(tr.state) || value.confirmedTo!==confirmedSyntaxEnd(tr.state) || options.bodyTabMode!==value.options.bodyTabMode || options.bodyTabSize!==value.options.bodyTabSize ? build(tr.state) : value;
	}});
	const views = new Set<EditorView>();
	return [field, ViewPlugin.fromClass(class {
		constructor(readonly view:EditorView){views.add(view);}
		destroy(){views.delete(this.view);}
	}), EditorView.decorations.of(view=>isActive(view)?view.state.field(field).decorations:Decoration.none),
		EditorState.transactionFilter.of(transaction=>{
			const owner = [...views].find(view=>view.state===transaction.startState);
			if (!owner || !isActive(owner) || owner.composing || transaction.startState.field(compositionStateField,false) ||
				transaction.newSelection.ranges.length!==1 || excludedSelectionModeForTransaction(transaction)!==null) return transaction;
			const range=transaction.newSelection.main, previous=transaction.startState.selection.main;
			if(transaction.docChanged&&transaction.isUserEvent('input')){
				const splits=transaction.startState.field(field).leading.filter(run=>{
					let split=false;transaction.changes.iterChanges((from,to,_a,_b,insert)=>{if(run.from<=from&&to<=run.to&&insert.toString().includes('\n'))split=true;});return split;
				});
				const changes:{from:number;to?:number;insert:string}[]=[];
				for(const run of splits){
					const first=transaction.newDoc.lineAt(transaction.changes.mapPos(run.from,-1)).number,last=transaction.newDoc.lineAt(transaction.changes.mapPos(run.to,1)).number;
					for(let number=first;number<=last;number++){
						const line=transaction.newDoc.line(number),prefix=run.depth?quotePrefix(line.text,run.depth):'';
						if(prefix===null)continue;
						const from=line.from+prefix.length,body=line.text.slice(prefix.length),owned=transaction.startState.field(field).delimiters.find(item=>run.from<=item.at&&item.at<run.to);
						const marker=owned?transaction.changes.mapPos(owned.at,-1):-1;
						const hasMarker=from<=marker&&marker<line.to&&transaction.newDoc.sliceString(marker,marker+1)==='\u200b';
						const clean=hasMarker?body.slice(0,marker-from)+body.slice(marker-from+1):body;
						const tabs=/^[ \t]*/u.exec(clean)![0].includes('\t');
						if(hasMarker&&!tabs)changes.push({from:marker,to:marker+1,insert:''});
						if(!hasMarker&&tabs)changes.push({from,insert:'\u200b'});
					}
				}
				if(changes.length)return [transaction,{changes,selection:transaction.newSelection.map(ChangeSet.of(changes,transaction.newDoc.length),1),sequential:true}];
			}
			const delimiter=previous.head-1;
			if (previous.empty && (transaction.isUserEvent('delete.backward') || transaction.isUserEvent('input')) &&
				transaction.startState.field(field).delimiters.some(item=>item.at===delimiter)) {
				const deleted:{from:number;to:number;insert:string}[]=[];
				transaction.changes.iterChanges((from,to,_newFrom,_newTo,insert)=>deleted.push({from,to,insert:insert.toString()}));
				if(deleted.length===1 && deleted[0]!.from===delimiter && deleted[0]!.to===previous.head && deleted[0]!.insert==='') {
					const owned=transaction.startState.field(field).delimiters.find(item=>item.at===delimiter)!;
					if(owned.bodyFrom<delimiter)return {changes:{from:delimiter-1,to:delimiter,insert:''},selection:EditorSelection.cursor(delimiter),
						userEvent:'delete.backward',annotations:isolateHistory.of('full')};
					const projection=bodyProjection(transaction.startState,delimiter);
					const content=projection?.state??transaction.startState;
					const at=projection?content.selection.main.head:delimiter;
					const blocks=discoverParagraphAuthority(content).blocks;
					const index=blocks.findIndex(block=>block.kind==='paragraph'&&block.from<=at&&at<=block.to);
					const block=blocks[index], before=blocks[index-1];
					const from=block && block.from<at ? at-1 : before?.kind==='paragraph'?before.to:null;
					if(from===null)return {selection:transaction.startState.selection};
					const sourceFrom=projection?.toSource(from)??from;
					return {changes:{from:sourceFrom,to:previous.head,insert:''},selection:EditorSelection.cursor(sourceFrom),
						userEvent:'delete.backward',annotations:isolateHistory.of('full')};
				}
			}
			if (transaction.docChanged && (transaction.isUserEvent('delete') || transaction.isUserEvent('input'))) {
				const cleanup = transaction.startState.field(field).delimiters.flatMap(({at}) => {
					const whitespace = /^[ \t]*/u.exec(transaction.startState.sliceDoc(at+1,transaction.startState.doc.lineAt(at).to))![0];
					let anchorDeleted=false, whitespaceChanged=false;
					transaction.changes.iterChanges((from,to,_newFrom,_newTo,insert) => {
						if (from<=at && at<to) anchorDeleted=true;
						if (from<at+1+whitespace.length && at+1<to) whitespaceChanged=true;
						if(insert.length&&at+1<=from&&from<=at+1+whitespace.length)whitespaceChanged=true;
					});
					if (anchorDeleted || !whitespaceChanged) return [];
					const mapped=transaction.changes.mapPos(at,1);
					const body=transaction.newDoc.sliceString(mapped,transaction.newDoc.lineAt(mapped).to);
					return bodyTabDelimiterOffset(body)===null ? [{from:mapped,to:mapped+1}] : [];
				});
				if (cleanup.length) return [transaction,{changes:cleanup,sequential:true}];
			}
			if(!recognizedNormalSelectionTransaction(transaction))return transaction;
			if (!range.empty && range.from===0 && range.to===transaction.newDoc.length) return transaction;
			const delimiters=transaction.state.field(field).delimiters;
			const normalize=(at:number)=>delimiters.some(item=>item.at===at)?at+1:at;
			let head=normalize(range.head);
			const owned=delimiters.find(item=>item.at===range.head);
			if (range.empty && !transaction.docChanged && !transaction.isUserEvent('select.pointer') &&
				owned && previous.head===range.head+1) {
				if(owned.bodyFrom<owned.at)head=owned.at-1;
				else if(transaction.newDoc.lineAt(range.head).from>0)head=transaction.newDoc.lineAt(range.head).from-1;
			}
			const anchor=range.empty?head:normalize(range.anchor);
			if (head===range.head && anchor===range.anchor) return transaction;
			return [transaction,{selection:EditorSelection.create([range.empty?EditorSelection.cursor(head,1):EditorSelection.range(anchor,head,range.goalColumn)]),sequential:true}];
		}),
		Prec.high(keymap.of([{key:'Tab',run:view=>isActive(view) && insertBodyTab(view)}])),
		Prec.highest(keymap.of([
			{key:'Home',run:view=>{
				if(!isActive(view)||view.composing||view.state.field(compositionStateField,false)||classifyCurrentSelectionMode(view.state)!=='caret')return false;
				const range=view.state.selection.main,line=view.state.doc.lineAt(range.head);
				const delimiter=view.state.field(field).delimiters.find(({at})=>line.from<=at&&at<=range.head);
				if(delimiter===undefined)return false;
				const start=delimiter.bodyFrom===delimiter.at?delimiter.at+1:delimiter.bodyFrom;
				view.dispatch({selection:EditorSelection.cursor(Math.max(start,view.moveToLineBoundary(range,false,true).head),1),userEvent:'select',scrollIntoView:true});return true;
			}}]))];
}
