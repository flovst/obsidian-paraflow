import type {TableActionTarget} from './action-target';
import type {TableEditingOptions} from './editing-types';
import {mergeCells,unmergeCell} from './operations';
import type {TableMenuItem} from './popup';

/** Shared actions bind the original selection and reject stale documents. */
export function tableMergeActions(target:TableActionTarget,options:TableEditingOptions,checkLifecycle:()=>void=()=>{}):TableMenuItem[] {
	const session=target.session,table=session.table,positions=[...target.positions];
	const merge=mergeCells(table,target.rectangle);
	const canUnmerge=table.cells.some(cell=>positions.some(position=>position.row===cell.row&&position.column===cell.column)&&(cell.rowSpan>1||cell.columnSpan>1));
	const check=()=>{checkLifecycle();if(!options.isActive(target.view)||options.isActiveView?.(target.view)===false)throw new Error('表格编辑目标已变化，请重新选择。');session.assertCurrent(target.view.state);};
	const run=(action:()=>void|Promise<void>)=>()=>{void Promise.resolve().then(()=>{check();return action();}).catch(error=>options.notify(error instanceof Error?error.message:String(error)));};
	return [
		{label:'合并单元格',icon:'combine',disabled:target.view.state.readOnly||merge.table===table,disabledReason:target.view.state.readOnly?'文档只读':merge.table===table?'请选择多个单元格':undefined,run:run(async()=>{
			if(target.view.state.readOnly)return;
			if(merge.discardedCells.length&&options.getMergeWarning()){
				const decision=await options.confirmMerge();if(!decision.confirmed)return;check();
				if(decision.suppressWarning)await options.setMergeWarning(false);
			}
			check();target.commit(merge.table,true);target.focus();
		})},
		{label:'取消合并',icon:'split',disabled:target.view.state.readOnly||!canUnmerge,disabledReason:target.view.state.readOnly?'文档只读':!canUnmerge?'所选单元格未合并':undefined,run:run(()=>{
			if(target.view.state.readOnly)return;
			let next=table;for(const position of positions)next=unmergeCell(next,position);target.commit(next,true);target.focus();
		})},
	];
}
