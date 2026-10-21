import {isolateHistory} from '@codemirror/commands';
import {syntaxTree} from '@codemirror/language';
import {Transaction, type EditorState, type Text, type TransactionSpec} from '@codemirror/state';
import type {Tree} from '@lezer/common';
import {GFM, parser} from '@lezer/markdown';
import type {TableModel} from './model';
import {gridToHtml, htmlToGrid, htmlToMarkdown, markdownToHtml, TableSerializationError, type HtmlTable} from './serialization';
import {reconcileRowGroups,type RowStructureChange} from './group-reconciliation';
import {quoteContainers} from '../callout/presentation-model';
import {projectQuoteContent} from '../callout/projection';
import {rewriteMarkdownCellContents} from './markdown-serialization';
import {htmlBlockExtents} from './html-table-range';
import {containerBodyContext,sameContainerBody} from '../callout/source-context';

export interface TableSource {
	readonly from: number;
	readonly to: number;
	readonly source: string;
	readonly kind: 'html' | 'markdown';
	readonly container?: { readonly kind:'quote'|'list';readonly depth:number;readonly task?:boolean;readonly prefixes:readonly string[];readonly rawSource:string; };
}

const markdownParser = parser.configure(GFM);

/** Read direct semantic children; projections retain their existing opaque block ownership. */
export function findTableSources(source: string, tree:Tree=markdownParser.parse(source)): TableSource[] {
	const tables: TableSource[] = [];
	let extents:ReturnType<typeof htmlBlockExtents>|undefined;
	let consumed=0;
	for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
		if(node.from<consumed)continue;
		const content = source.slice(node.from, node.to);
		if (node.name === 'Table') tables.push({from:node.from,to:node.to,source:content,kind:'markdown'});
		else if (node.name === 'HTMLBlock' && /^<table(?:\s|>)/iu.test(content)) {
			const extent=(extents??=htmlBlockExtents(source)).get(node.from);
			if(extent){tables.push({from:node.from,to:extent.to,source:source.slice(node.from,extent.to),kind:'html'});consumed=extent.to;}
		}
	}
	return tables;
}

const stateSources=new WeakMap<EditorState,TableSource[]>();
// Preserve old-state answers; only the latest ownership variant is shared by states with the same Text.
const sourceCache=new WeakMap<Text,{context:ReturnType<typeof containerBodyContext>|null;tables:TableSource[]}>();
function findListTableSources(state:EditorState,tree:Tree):TableSource[] {
	const tables:TableSource[]=[];
	tree.iterate({enter(node){
		if(node.name==='Blockquote')return false;
		if(node.name!=='Table'&&node.name!=='HTMLBlock')return;
		let depth=0,owner=node.node.parent;
		for(let parent=owner;parent;parent=parent.parent)if(parent.name==='ListItem')depth++;
		if(!depth)return false;
		while(owner&&owner.name!=='ListItem')owner=owner.parent;
		const first=state.doc.lineAt(node.from),prefix=state.sliceDoc(first.from,node.from);
		if(!/^[ \t]+$/u.test(prefix))return false;
		const last=state.doc.lineAt(node.to),prefixes:string[]=[],lines:string[]=[];
		for(let number=first.number;number<=last.number;number++){
			const line=state.doc.line(number),text=state.sliceDoc(line.from,Math.min(line.to,node.to));
			if(text&&!text.startsWith(prefix))return false;
			const leading=text?prefix:'';prefixes.push(leading);lines.push(text.slice(leading.length));
		}
		const semantic=lines.join('\n'),table=findTableSources(semantic)[0];
		if(!table||table.from!==0)return false;
		const rowCount=table.source.split('\n').length;
		const to=first.from+table.to+prefixes.slice(0,rowCount).reduce((length,value)=>length+value.length,0);
		const ownerLine=state.doc.lineAt(owner!.from).text;
		tables.push({...table,from:first.from,to,container:{kind:'list',depth,task:/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+\[[ xX]\][ \t]/u.test(ownerLine),
			prefixes:prefixes.slice(0,rowCount),rawSource:state.sliceDoc(first.from,to)}});
		return false;
	}});
	return tables;
}
/** Containers contribute only source mapping; their body uses the ordinary table parser. */
export function findEditableTableSources(state:EditorState):TableSource[] {
	const cached=stateSources.get(state);if(cached)return cached;
	const shared=sourceCache.get(state.doc);
	if(shared?.context===null){stateSources.set(state,shared.tables);return shared.tables;}
	const source=shared?undefined:state.doc.toString();
	// Every GFM table has a literal pipe, and every HTML table has a literal opening angle bracket.
	if(source!==undefined&&!source.includes('|')&&!source.includes('<')){
		const tables:TableSource[]=[];sourceCache.set(state.doc,{context:null,tables});stateSources.set(state,tables);return tables;
	}
	const context=source!==undefined&&!source.includes('>')?null:containerBodyContext(state);
	if(shared&&context&&sameContainerBody(shared.context,context)){stateSources.set(state,shared.tables);return shared.tables;}
	const text=source??state.doc.toString(),tree=markdownParser.parse(text);
	const tables=[...findTableSources(text,tree),...findListTableSources(state,tree)];
	for(const card of quoteContainers(state)){
		const body=projectQuoteContent(state,card.kind==='callout'?card.headerTo+1:card.from,card.to,card.depth);if(!body)continue;
		for(const table of findTableSources(body.state.doc.toString(),syntaxTree(body.state))){
			const mappedFrom=body.toSource(table.from),from=state.doc.lineAt(mappedFrom).from,to=body.toSource(table.to);
			const first=body.state.doc.lineAt(table.from).number,last=body.state.doc.lineAt(table.to).number;
			const prefixes=body.lines.slice(first-1,last).map(line=>line.prefix);prefixes[0]=state.sliceDoc(from,mappedFrom);
			tables.push({...table,from,to,container:{kind:'quote',depth:card.depth,prefixes,rawSource:state.sliceDoc(from,to)}});
		}
	}
	tables.sort((a,b)=>a.from-b.from);sourceCache.set(state.doc,{context,tables});stateSources.set(state,tables);return tables;
}

export function assertTableSourceCurrent(state:EditorState,target:TableSource):void {
	if(!findEditableTableSources(state).some(table=>table.from===target.from&&table.to===target.to&&table.kind===target.kind&&table.source===target.source&&table.container?.kind===target.container?.kind&&table.container?.depth===target.container?.depth&&table.container?.rawSource===target.container?.rawSource))throw new Error('The table changed while the operation was open. Please select it again.');
}
export function withTablePrefixes(target:TableSource,source:string,change?:RowStructureChange):string {
	if(!target.container)return source;
	const prefixes=[...target.container.prefixes],continuation=prefixes[0]!;
	// Keep the container's structural prefix when its table is removed.
	if(!source)return continuation;
	if(target.kind==='markdown'&&change){
		const separator=prefixes.splice(1,1)[0]!;
		if(change.kind==='insert')prefixes.splice(change.index,0,continuation);
		else if(change.kind==='delete')prefixes.splice(change.index,change.count);
		else if(change.kind==='move'){const moved=prefixes.splice(change.first,change.last-change.first+1);prefixes.splice(change.first+change.direction,0,...moved);}
		else if(change.kind==='sort'){const original=[...prefixes];prefixes.splice(0,prefixes.length,...change.origins.map(row=>original[row]!));}
		else if(change.kind==='duplicate')prefixes.splice(change.last+1,0,...prefixes.slice(change.first,change.last+1));
		else {prefixes.splice(change.rows);while(prefixes.length<change.rows)prefixes.push(continuation);}
		prefixes.splice(1,0,separator);
	}
	return source.split('\n').map((line,index)=>(prefixes[index]??continuation)+line).join('\n');
}

/** Parsed content has no DOM or source positions; sessions can safely share these values. */
function immutableEnvelope(envelope:HtmlTable):HtmlTable {
	for(const cell of envelope.table.cells) {
		Object.freeze(cell.attributes);Object.freeze(cell.style);Object.freeze(cell);
	}
	Object.freeze(envelope.table.cells);Object.freeze(envelope.table);
	for(const group of envelope.rowGroups)Object.freeze(group);
	Object.freeze(envelope.rowGroups);
	return Object.freeze(envelope);
}

/** A snapshot is intentionally invalid after any change to its source range. */
export class TableEditSession {
	readonly envelope: HtmlTable;
	readonly target:TableSource;
	get table(): TableModel { return this.envelope.table; }
	constructor(private readonly parsedTarget:TableSource,renderedTo=parsedTarget.to,parsedEnvelope?:HtmlTable) {
		this.target=renderedTo===parsedTarget.to?parsedTarget:{...parsedTarget,to:renderedTo,source:parsedTarget.source.slice(0,renderedTo-parsedTarget.from)};
		this.envelope = parsedEnvelope ?? immutableEnvelope(htmlToGrid(this.target.kind === 'html' ? this.target.source : markdownToHtml(this.target.source)));
	}
	assertCurrent(state: EditorState): void {
		assertTableSourceCurrent(state,this.parsedTarget);
	}
	serialize(table: TableModel, structureChanged = true, change?:RowStructureChange): string {
		return gridToHtml({...this.envelope,table,rowGroups:structureChanged?reconcileRowGroups(this.envelope,table,change):this.envelope.rowGroups});
	}
	serializeContent(table:TableModel):string {return this.target.kind==='markdown'?rewriteMarkdownCellContents(this.target.source,this.table,table):this.serialize(table,false);}
	/** Only explicit format/structure commits choose the smallest lossless representation. */
	serializeAction(table:TableModel,structureChanged=true,change?:RowStructureChange):string {
		const html=this.serialize(table,structureChanged,change);
		try{return htmlToMarkdown(html,'native');}catch(error){if(error instanceof TableSerializationError)return html;throw error;}
	}
	transaction(state: EditorState, table: TableModel | null, structureChanged = true, change?:RowStructureChange): TransactionSpec {
		this.assertCurrent(state);
		const insert = table ? this.serialize(table,structureChanged,change) : '';
		return this.replace(state,insert);
	}
	toMarkdown(state: EditorState): TransactionSpec {
		this.assertCurrent(state);
		return this.replace(state,htmlToMarkdown(this.serialize(this.table,false),'native'));
	}
	replace(state: EditorState, insert: string,change?:RowStructureChange): TransactionSpec {
		this.assertCurrent(state);
		insert=withTablePrefixes(this.target,insert,change);
		return {changes:{from:this.target.from,to:this.target.to,insert}, selection:{anchor:this.target.from},
			annotations:[Transaction.userEvent.of('input.table'),isolateHistory.of('full')]};
	}
}
