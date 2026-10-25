import {validateTable} from './grid';
import type {TableAxis,TableModel} from './model';

export function duplicateTracks(table:TableModel,axis:TableAxis,first:number,last:number):TableModel {
	validateTable(table);const span=axis==='row'?'rowSpan':'columnSpan',size=last-first+1;
	if(table.cells.some(cell=>cell[axis]<first&&cell[axis]+cell[span]>first||cell[axis]<=last&&cell[axis]+cell[span]>last+1))throw new Error('复制会切开合并单元格，请选择完整合并范围或先取消合并。');
	const cells=table.cells.flatMap(cell=>cell[axis]>=first&&cell[axis]<=last?[cell,{...cell,[axis]:cell[axis]+size}]:[{...cell,[axis]:cell[axis]>last?cell[axis]+size:cell[axis]}]).sort((a,b)=>a.row-b.row||a.column-b.column);
	const result={...table,[axis==='row'?'rows':'columns']:(axis==='row'?table.rows:table.columns)+size,cells};validateTable(result);return result;
}

/** Reorder tracks only when every existing merged rectangle remains contiguous. */
export function moveTracks(table:TableModel,axis:TableAxis,first:number,last:number,direction:-1|1):TableModel {
	return moveTracksTo(table,axis,first,last,first+direction);
}

/** Destination is the first track index after removing the selected block. */
export function moveTracksTo(table:TableModel,axis:TableAxis,first:number,last:number,destination:number):TableModel {
	validateTable(table);const count=axis==='row'?table.rows:table.columns;
	if(!Number.isInteger(first)||!Number.isInteger(last)||first<0||last>=count||first>last)throw new Error('无效的行列范围。');
	if(destination<0||destination>count-(last-first+1)||destination===first)return table;
	const order=Array.from({length:count},(_,index)=>index);const block=order.splice(first,last-first+1);order.splice(destination,0,...block);
	const positions=new Map(order.map((old,index)=>[old,index]));const span=axis==='row'?'rowSpan':'columnSpan';
	const cells=table.cells.map(cell=>{
		const mapped=Array.from({length:cell[span]},(_,offset)=>positions.get(cell[axis]+offset)!).sort((a,b)=>a-b);
		if(mapped[mapped.length-1]!-mapped[0]!+1!==cell[span])throw new Error('移动会分开已有合并单元格。请选择完整合并范围，或先取消合并。');
		const moved={...cell,[axis]:mapped[0]!};
		if(axis==='row'){
			// Header roles belong to table positions; authored content formatting moves with the cell.
			const destinations=table.cells.filter(slot=>slot.row<moved.row+moved.rowSpan&&slot.row+slot.rowSpan>moved.row&&slot.column<moved.column+moved.columnSpan&&slot.column+slot.columnSpan>moved.column);
			const role=destinations[0]!.role;
			if(destinations.some(slot=>slot.role!==role))throw new Error('移动后的合并单元格会跨越表头与正文。请先取消合并。');
			moved.role=role;
		}
		return moved;
	}).sort((a,b)=>a.row-b.row||a.column-b.column);
	const result={...table,cells};validateTable(result);return result;
}
