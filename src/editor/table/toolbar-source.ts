import {GFM,parser} from '@lezer/markdown';
import type {SyntaxNode} from '@lezer/common';
import {Transaction,type EditorState,type TransactionSpec} from '@codemirror/state';
import {isolateHistory} from '@codemirror/commands';
import {assertTableSourceCurrent,withTablePrefixes,type TableSource} from './edit-session';
import type {TableModel} from './model';
import {deleteTrack,insertTrack} from './operations';

const markdownParser=parser.configure(GFM);

function readMarkdown(source:string):{rows:SyntaxNode[];separator:SyntaxNode;columns:number} {
	const table=markdownParser.parse(source).topNode.firstChild;
	if(!table||table.name!=='Table'||table.nextSibling)throw new Error('请选择完整的 Markdown 表格。');
	const header=table.firstChild!;const separator=header.nextSibling!;const rows=[header];
	for(let row=separator.nextSibling;row;row=row.nextSibling)rows.push(row);
	const columns=separatorCells(source.slice(separator.from,separator.to)).length;
	return {rows,separator,columns};
}
function separatorCells(line:string):string[] {return line.trim().replace(/^\|/u,'').replace(/\|$/u,'').split('|');}
function cells(source:string,row:SyntaxNode):string[] {
	const delimiters:number[]=[];for(let child=row.firstChild;child;child=child.nextSibling)if(child.name==='TableDelimiter')delimiters.push(child.from);
	const boundaries=[row.from,...delimiters,row.to];const result:string[]=[];
	for(let index=0;index<boundaries.length-1;index++){
		const text=source.slice(boundaries[index]!+(index?1:0),boundaries[index+1]);
		if((index===0||index===boundaries.length-2)&&!text.trim()&&delimiters.length)continue;
		result.push(text);
	}return result;
}
export function markdownDimensions(source:string):{rows:number;columns:number} {const table=readMarkdown(source);return {rows:table.rows.length,columns:table.columns};}
/** Source selection must name the same native cell as the semantic focus bookmark. */
export function markdownCellSourceEnd(source:string,rowIndex:number,column:number):number {
	const row=readMarkdown(source).rows[rowIndex]!,delimiters:number[]=[];
	for(let child=row.firstChild;child;child=child.nextSibling)if(child.name==='TableDelimiter')delimiters.push(child.from);
	const boundaries=[row.from,...delimiters,row.to],ends:number[]=[];
	for(let index=0;index<boundaries.length-1;index++){
		const from=boundaries[index]!+(index?1:0),to=boundaries[index+1]!,text=source.slice(from,to);
		if((index===0||index===boundaries.length-2)&&!text.trim()&&delimiters.length)continue;
		ends.push(to-(text.match(/[ \t]+$/u)?.[0].length??0));
	}
	return ends[column]??row.to;
}
/** Format lexical cell boundaries; inline Markdown never passes through an HTML model. */
export function formatMarkdownTable(source:string):string {
	const lineEnding=source.includes('\r\n')?'\r\n':'\n';source=source.replace(/\r\n/gu,'\n');
	const table=readMarkdown(source),rows=table.rows.map(row=>cells(source,row).map(value=>value.replace(/^[ \t]+|[ \t]+$/gu,'')));
	const markers=separatorCells(source.slice(table.separator.from,table.separator.to)).map(value=>value.trim());
	const widths=Array.from({length:table.columns},(_,column)=>Math.max(3,...rows.map(row=>(row[column]??'').length)));
	const lines=rows.map(row=>`| ${Array.from({length:Math.max(table.columns,row.length)},(_,column)=>{
		const text=row[column]??'',width=widths[column]??text.length,remaining=width-text.length,marker=markers[column]??'';
		const left=marker.endsWith(':')?(marker.startsWith(':')?Math.floor(remaining/2):remaining):0;
		return ' '.repeat(left)+text+' '.repeat(remaining-left);
	}).join(' | ')} |`);
	lines.splice(1,0,`| ${widths.map((width,column)=>{const marker=markers[column]??'---',left=marker.startsWith(':'),right=marker.endsWith(':');return `${left?':':''}${'-'.repeat(width-Number(left)-Number(right))}${right?':':''}`;}).join(' | ')} |`);
	return lines.join(lineEnding);
}
export function markdownColumnAlignments(source:string,first:number,last:number):readonly ('left'|'center'|'right'|null)[] {
	const {separator}=readMarkdown(source);
	return separatorCells(source.slice(separator.from,separator.to)).slice(first,last+1).map(value=>{
		const marker=value.trim();return marker.startsWith(':')?(marker.endsWith(':')?'center':'left'):marker.endsWith(':')?'right':null;
	});
}
export function explicitMarkdownAlignment(source:string,first:number,last:number):'left'|'center'|'right'|null {
	const alignments=markdownColumnAlignments(source,first,last);
	return alignments.length&&alignments.every(value=>value===alignments[0])?alignments[0]!:null;
}
export function validateDimensions(rows:number,columns:number):void {
	if(!Number.isSafeInteger(rows)||!Number.isSafeInteger(columns)||rows<0||columns<0||rows*columns>10000)throw new Error('请输入非负整数；表格不超过 10000 个单元格。');
}
/** Structural edits preserve retained Markdown tokens, including content not admitted for HTML conversion. */
export function resizeMarkdownTable(source:string,rows:number,columns:number):string {
	validateDimensions(rows,columns);if(!rows||!columns)return '';
	const table=readMarkdown(source);if(rows===table.rows.length&&columns===table.columns)return source;
	const lineEnding=source.includes('\r\n')?'\r\n':'\n';
	const resize=(entries:string[],empty:string)=>Array.from({length:columns},(_,index)=>entries[index]??empty).join('|');
	const lines=table.rows.slice(0,rows).map(row=>columns===table.columns?source.slice(row.from,row.to):`|${resize(cells(source,row),'  ')}|`);
	while(lines.length<rows)lines.push(`|${Array.from({length:columns},()=> '  ').join('|')}|`);
	const separator=source.slice(table.separator.from,table.separator.to);
	lines.splice(1,0,columns===table.columns?separator:`|${resize(separatorCells(separator),' --- ')}|`);
	return lines.join(lineEnding);
}

function rewriteMarkdownTracks(source:string,axis:'row'|'column',reorder:(tracks:(number|null)[])=>void):string {
	const table=readMarkdown(source),tracks:Array<number|null>=Array.from({length:axis==='row'?table.rows.length:table.columns},(_,index)=>index);reorder(tracks);if(!tracks.length)return '';
	let separator=source.slice(table.separator.from,table.separator.to);
	const blank=`|${Array.from({length:table.columns},()=> '  ').join('|')}|`;
	const lines=axis==='row'?tracks.map(index=>index===null?blank:source.slice(table.rows[index]!.from,table.rows[index]!.to)):table.rows.map(row=>{const values=cells(source,row);return `|${tracks.map(index=>index===null?'  ':values[index]!).join('|')}|`;});
	if(axis==='column'){const values=separatorCells(separator);separator=`|${tracks.map(index=>index===null?' --- ':values[index]!).join('|')}|`;}
	lines.splice(1,0,separator);return lines.join(source.includes('\r\n')?'\r\n':'\n');
}
export function insertMarkdownTrack(source:string,axis:'row'|'column',index:number):string {return rewriteMarkdownTracks(source,axis,tracks=>{tracks.splice(index,0,null);});}
export function deleteMarkdownTracks(source:string,axis:'row'|'column',first:number,last:number):string {return rewriteMarkdownTracks(source,axis,tracks=>{tracks.splice(first,last-first+1);});}
export function moveMarkdownTracks(source:string,axis:'row'|'column',first:number,last:number,destination:number):string {return rewriteMarkdownTracks(source,axis,tracks=>{const moved=tracks.splice(first,last-first+1);tracks.splice(destination,0,...moved);});}
/** Alignment is a native pipe-table column property, so only its separator is edited. */
export function alignMarkdownColumns(source:string,first:number,last:number,alignment:'left'|'center'|'right'):string {
	const table=readMarkdown(source);
	if(first<0||last>=table.columns||first>last)throw new Error('列选区已变化，请重新选择。');
	const clear=explicitMarkdownAlignment(source,first,last)===alignment;
	const separator=source.slice(table.separator.from,table.separator.to);let column=0;
	const next=separator.replace(/:?-+:?/gu,marker=>{
		const selected=column>=first&&column<=last;column++;if(!selected)return marker;
		const dashes=marker.replace(/:/gu,'');if(clear)return dashes;return `${alignment==='right'?'':':'}${dashes}${alignment==='left'?'':':'}`;
	});
	return source.slice(0,table.separator.from)+next+source.slice(table.separator.to);
}
export function resizeHtmlTable(table:TableModel,rows:number,columns:number):TableModel|null {
	validateDimensions(rows,columns);if(!rows||!columns)return null;
	let next=table;
	while(next.rows>rows)next=deleteTrack(next,'row',next.rows-1)!;
	while(next.columns>columns)next=deleteTrack(next,'column',next.columns-1)!;
	while(next.rows<rows)next=insertTrack(next,'row',next.rows);
	while(next.columns<columns)next=insertTrack(next,'column',next.columns);
	return next;
}
export function replaceTableSource(state:EditorState,target:TableSource,insert:string):TransactionSpec {
	assertTableSourceCurrent(state,target);insert=withTablePrefixes(target,insert);
	return {changes:{from:target.from,to:target.to,insert},selection:{anchor:target.from},annotations:[Transaction.userEvent.of('input.table'),isolateHistory.of('full')]};
}
