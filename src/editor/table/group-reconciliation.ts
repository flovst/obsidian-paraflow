import type {TableModel} from './model';
import type {HtmlTable,TableRowGroup} from './serialization';

export type RowStructureChange={kind:'insert';index:number}|{kind:'delete';index:number;count:number}|{kind:'move';first:number;last:number;direction:number}|{kind:'resize';rows:number}|{kind:'sort';origins:readonly number[]}|{kind:'duplicate';first:number;last:number};

/** Preserve unaffected row groups. Only groups crossed by a span are joined. */
export function reconcileRowGroups(original:HtmlTable,table:TableModel,change?:RowStructureChange):TableRowGroup[] {
	const origins=Array.from({length:original.table.rows},(_,row)=>row);
	if(change?.kind==='insert')origins.splice(change.index,0,Math.min(change.index,original.table.rows-1));
	else if(change?.kind==='delete')origins.splice(change.index,change.count);
	else if(change?.kind==='move'){const moved=origins.splice(change.first,change.last-change.first+1);origins.splice(change.first+change.direction,0,...moved);}
	else if(change?.kind==='resize'){origins.splice(change.rows);while(origins.length<change.rows)origins.push(original.table.rows-1);}
	else if(change?.kind==='sort')origins.splice(0,origins.length,...change.origins);
	else if(change?.kind==='duplicate')origins.splice(change.last+1,0,...origins.slice(change.first,change.last+1));
	if(origins.length!==table.rows)throw new Error('Row-count changes require explicit row-group mapping');
	const groups:Array<TableRowGroup&{id:number}>=[];
	for(let row=0;row<origins.length;row++){
		const old=origins[row]!;const id=original.rowGroups.findIndex(group=>old>=group.startRow&&old<group.startRow+group.rowCount);const kind=original.rowGroups[id]!.kind;
		const previous=groups[groups.length-1];if(previous?.id===id)groups[groups.length-1]={...previous,rowCount:previous.rowCount+1};else groups.push({id,kind,startRow:row,rowCount:1});
	}
	for(let index=1;index<groups.length;){
		const boundary=groups[index]!.startRow;
		if(table.cells.some(cell=>cell.row<boundary&&cell.row+cell.rowSpan>boundary)){
			const before=groups[index-1]!,after=groups[index]!;groups.splice(index-1,2,{id:-1,kind:'tbody',startRow:before.startRow,rowCount:before.rowCount+after.rowCount});
		}else index++;
	}
	return groups.map((group,index)=>({kind:group.kind==='thead'&&index!==0||group.kind==='tfoot'&&index!==groups.length-1?'tbody':group.kind,startRow:group.startRow,rowCount:group.rowCount}));
}
