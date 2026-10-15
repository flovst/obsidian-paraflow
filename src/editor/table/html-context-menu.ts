import {captureTableActionTarget,type TableActionTarget,type TextBookmark} from './action-target';
import type {TableEditingOptions} from './editing-types';
import type {TableAxis,TableModel} from './model';
import type {TableFocusBookmark} from './focus-handoff';
import type {RowStructureChange} from './group-reconciliation';
import {deleteTrack,insertTrack} from './operations';
import {duplicateTracks,moveTracks} from './reordering';
import {applyCellStyle} from './formatting';
import {sortTableRows} from './sorting';
import {tableMergeActions} from './merge-actions';
import {tableSourceActions} from './source-actions';
import {tableEnhancementItems} from './primary-actions';
import {tableTextActions} from './text-actions';
import type {TableMenuItem} from './popup';
import {beginTableActions,showTableActions} from './table-actions';

export function showTableContextMenu(target:TableActionTarget,options:TableEditingOptions,point:{x:number;y:number},advanced:(bookmark:TextBookmark|null)=>void=()=>{showTableActions(target,options,point);},onClose?:()=>void):{close:()=>void} {
	target=captureTableActionTarget(target);
	const lifecycle=beginTableActions(target);
	const session=target.session,table=session.table,tracks={...target.trackRectangle},focus=target.focusBookmark,bookmark=target.textBookmark;
	const check=()=>{if(lifecycle.cancelled||!options.isActive(target.view)||options.isActiveView?.(target.view)===false)throw new Error('表格操作目标已变化，请重新选择。');session.assertCurrent(target.view.state);};
	const run=(action:()=>void)=>()=>{try{check();if(target.view.state.readOnly)return;action();}catch(error){options.notify(error instanceof Error?error.message:String(error));}};
	const apply=(next:TableModel|null,change?:RowStructureChange,nextFocus:TableFocusBookmark=focus)=>{target.replaceSource(next?(session.target.kind==='markdown'?session.serializeAction(next,true,change):session.serialize(next,true,change)):'',change,nextFocus);};
	const planned=(label:string,plan:()=>{table:TableModel|null;change?:RowStructureChange;focus?:TableFocusBookmark},separatorBefore=false):TableMenuItem=>{
		if(target.view.state.readOnly)return {label,disabled:true,disabledReason:'文档只读',separatorBefore};
		try{const result=plan();return {label,separatorBefore,run:run(()=>apply(result.table,result.change,result.focus))};}
		catch(error){return {label,separatorBefore,disabled:true,disabledReason:error instanceof Error?error.message:String(error)};}
	};
	const trackItems=(axis:TableAxis):TableMenuItem[]=>{
		const row=axis==='row',first=row?tracks.top:tracks.left,last=row?tracks.bottom:tracks.right,count=row?table.rows:table.columns;
		const insert=(index:number)=>({table:insertTrack(table,axis,index),change:row?{kind:'insert' as const,index}:undefined,focus:{cell:{row:row?index:focus.cell.row,column:row?0:index},from:0,to:0,text:''}});
		const move=(direction:-1|1)=>{if(direction<0&&first===0||direction>0&&last===count-1)throw new Error(row?(direction<0?'已是第一行':'已是最后一行'):(direction<0?'已是第一列':'已是最后一列'));return {table:moveTracks(table,axis,first,last,direction),change:row?{kind:'move' as const,first,last,direction}:undefined,focus:{...focus,cell:{...focus.cell,[axis]:focus.cell[axis]+direction},rectangle:undefined}};};
		const result=[planned(row?'在上方新增行':'在左侧新增列',()=>insert(first)),planned(row?'在下方新增行':'在右侧新增列',()=>insert(last+1)),planned(row?'向上移动行':'向左移动列',()=>move(-1),true),planned(row?'向下移动行':'向右移动列',()=>move(1))];
		if(!row)for(const [value,label] of [['left','左对齐'],['center','居中对齐'],['right','右对齐']] as const)result.push(planned(label,()=>{
			const positions=table.cells.filter(cell=>cell.column<=last&&cell.column+cell.columnSpan>first);
			if(positions.some(cell=>cell.column<first||cell.column+cell.columnSpan-1>last))throw new Error('请选中完整合并列范围，或先取消合并。');
			return {table:applyCellStyle(table,positions,'text-align',value)};
		},value==='left'));
		result.push(planned(row?'复制行':'复制列',()=>({table:duplicateTracks(table,axis,first,last),change:row?{kind:'duplicate',first,last}:undefined}),true));
		result.push(planned(row?'删除行':'删除列',()=>{let next:TableModel|null=table;for(let index=last;index>=first&&next;index--)next=deleteTrack(next,axis,index);return {table:next,change:row?{kind:'delete',index:first,count:last-first+1}:undefined,focus:{cell:{row:Math.min(focus.cell.row,(next?.rows??1)-1),column:Math.min(focus.cell.column,(next?.columns??1)-1)},from:0,to:0,text:''}};}));
		return result;
	};
	const sort=(direction:1|-1)=>planned(direction===1?'按列升序 (A-Z)':'按列降序 (Z-A)',()=>{const sorted=sortTableRows(session.envelope,focus.cell.column,direction,target.view.dom.ownerDocument);return {table:sorted.table,change:{kind:'sort',origins:sorted.origins},focus:{...focus,cell:{...focus.cell,row:sorted.origins.indexOf(focus.cell.row)},rectangle:undefined}};},direction===1);
	const items:TableMenuItem[]=[...tableTextActions(target,options,check),...tableEnhancementItems(options,tableMergeActions(target,options,check),tableSourceActions(target.view,session.target,options,null,target,check),()=>{check();advanced(bookmark);}),{label:'行',icon:'table',separatorBefore:true,children:trackItems('row')},{label:'列',icon:'table',children:trackItems('column')},{...sort(1),icon:'arrow-down-az'},{...sort(-1),icon:'arrow-up-za'}];
	const popup=options.showMenu!(target.view.dom.ownerDocument,point,items,onClose,options.renderMenuIcon);lifecycle.close=popup.close;return popup;
}
