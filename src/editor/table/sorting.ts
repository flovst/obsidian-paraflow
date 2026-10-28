import { createDetachedEl } from '../../dom';
import {validateTable} from './grid';
import type {TableModel} from './model';
import type {HtmlTable} from './serialization';
import {admittedFragment} from './admitted-dom';

/** Sort complete data rows within their original row groups; headers and footers stay fixed. */
export function sortTableRows(envelope:HtmlTable,column:number,direction:1|-1,doc:Document):{table:TableModel;origins:number[]} {
	const table=envelope.table;validateTable(table);
	const origins=Array.from({length:table.rows},(_,row)=>row);
	const value=(row:number)=>{const cell=table.cells.find(cell=>cell.row<=row&&row<cell.row+cell.rowSpan&&cell.column<=column&&column<cell.column+cell.columnSpan)!;const element=createDetachedEl(doc, 'div');element.append(admittedFragment(doc,cell.html));return (element.textContent??'').trim();};
	const collator=new Intl.Collator(undefined,{numeric:true});
	for(const group of envelope.rowGroups){
		if(group.kind!=='tbody')continue;
		const first=group.startRow===0&&table.cells.filter(cell=>cell.row===0).every(cell=>cell.role==='th')?1:group.startRow;
		const values=new Map(origins.slice(first,group.startRow+group.rowCount).map(row=>[row,value(row)]));
		const sorted=origins.slice(first,group.startRow+group.rowCount).sort((a,b)=>direction*collator.compare(values.get(a)!,values.get(b)!));
		origins.splice(first,sorted.length,...sorted);
	}
	const positions=new Map(origins.map((old,row)=>[old,row]));
	const cells=table.cells.map(cell=>{
		const row=positions.get(cell.row)!;
		for(let offset=1;offset<cell.rowSpan;offset++)if(positions.get(cell.row+offset)!==row+offset)throw new Error('排序会拆开或改变纵向合并单元格，请先取消合并。');
		return {...cell,row};
	}).sort((a,b)=>a.row-b.row||a.column-b.column);
	const sorted={...table,cells};validateTable(sorted);return {table:sorted,origins};
}
