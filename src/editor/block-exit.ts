import {EditorSelection, type EditorState, type TransactionSpec} from '@codemirror/state';
import {isolateHistory} from '@codemirror/commands';
import { codeBlocksIn } from './code-blocks/source-scan';
import {findEditableTableSources} from './table/edit-session';
import {selectionModeAnnotation} from './runtime/input-state';
import {prefixPolicy} from './structured-list/prefix';
import {enterVirtualTail} from './runtime/virtual-tail';

export function codeExitPrefix(state:EditorState,to:number):string {
	return /^([ \t]*(?:>[ \t]*)*)[`~]/u.exec(state.doc.lineAt(to).text)![1]!;
}

function existingEmptyParagraphs(state:EditorState,to:number,prefix:string):readonly number[] {
	const rows = [];
	for(let number=state.doc.lineAt(to).number+1;number<=state.doc.lines;number++) {
		const line=state.doc.line(number);
		if(line.text.trim()!==prefix.trim())break;
		rows.push(line);
	}
	const anchors=rows.filter((_row,index)=>index%2===1&&index<rows.length-1).map(row=>row.to);
	const last=rows.at(-1);
	if(last?.number===state.doc.lines)anchors.push(last.to);
	return anchors;
}

function followingContent(state:EditorState,to:number,prefix:string):number|null {
	for(let number=state.doc.lineAt(to).number+1;number<=state.doc.lines;number++) {
		const line=state.doc.line(number);
		if(line.text.trim()===prefix.trim())continue;
		const from=line.from+(line.text.startsWith(prefix)?prefix.length:0);
		const text=state.doc.sliceString(from,line.to);
		return prefixPolicy.parse(text,from)?.full.to ?? from+(/^#{1,6}[ \t]+/u.exec(text)?.[0].length??0);
	}
	return null;
}

/** Navigation reuses source-backed content; EOF uses the shared virtual body target. */
export function blockExitPlan(state:EditorState,to:number,prefix='',goalColumn?:number):TransactionSpec {
	if(/^[ \t\n]*$/u.test(state.sliceDoc(to)))return enterVirtualTail(state,{goalColumn,input:'keyboard'});
	const existing=existingEmptyParagraphs(state,to,prefix)[0]??followingContent(state,to,prefix);
	if(existing===null){
		return enterVirtualTail(state,{goalColumn,input:'keyboard'});
	}
	return {selection:EditorSelection.create([EditorSelection.cursor(existing,1,undefined,goalColumn)]),
		annotations:[selectionModeAnnotation.of('normal'),isolateHistory.of('full')],
		userEvent:'move.line',scrollIntoView:true};
}

/** Only source-backed empty paragraphs and the document endpoint are editable. */
export function blockExitAnchors(state:EditorState):ReadonlySet<number> {
	const anchors=new Set<number>();
	for(const block of codeBlocksIn(state.doc)) {
		if(!block.closed||block.indented)continue;
		for(const anchor of existingEmptyParagraphs(state,block.to,codeExitPrefix(state,block.to)))anchors.add(anchor);
	}
	for(const table of findEditableTableSources(state)) {
		for(const anchor of existingEmptyParagraphs(state,table.to,table.container?.prefixes[0]??''))anchors.add(anchor);
	}
	return anchors;
}
