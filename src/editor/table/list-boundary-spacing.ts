import type {EditorState} from '@codemirror/state';
import {discoverCodeBlocks} from '../code-blocks/model';
import {quoteContainers} from '../callout/presentation-model';
import type {TableSource} from './edit-session';

/** A single source separator around a list-owned replacement still owns block rhythm. */
export function listTableBoundaryRows(state:EditorState,tables:readonly TableSource[]):ReadonlyMap<number,{before:string;after:string}> {
	const rows=new Map<number,{before:string;after:string}>();
	const nested=tables.filter(table=>table.container?.kind==='list');
	if(!nested.length)return rows;
	const code=discoverCodeBlocks(state),quotes=quoteContainers(state);
	const tag=(position:number):string=>{
		if(code.some(block=>block.from<=position&&position<=block.to))return 'code-block';
		if(tables.some(table=>table.from<=position&&position<=table.to))return 'table';
		if(quotes.some(quote=>quote.from<=position&&position<=quote.to))return 'blockquote';
		return 'p';
	};
	for(const table of nested){
		const first=state.doc.lineAt(table.from).number,last=state.doc.lineAt(table.to).number;
		if(first>2){
			const gap=state.doc.line(first-1),before=state.doc.line(first-2);
			if(!gap.text.trim()&&before.text.trim())rows.set(gap.from,{before:tag(before.to),after:'table'});
		}
		if(last+2<=state.doc.lines){
			const gap=state.doc.line(last+1),after=state.doc.line(last+2);
			if(!gap.text.trim()&&after.text.trim())rows.set(gap.from,{before:'table',after:tag(after.from)});
		}
	}
	return rows;
}
