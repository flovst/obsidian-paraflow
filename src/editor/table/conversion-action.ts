import { createDetachedEl } from '../../dom';
import type {TableActionTarget} from './action-target';
import type {TableEditingOptions} from './editing-types';
import {planHtmlToMarkdown} from './markdown-serialization';
import {htmlToGrid,markdownToHtml} from './serialization';
import {admittedFragment} from './admitted-dom';

/** Bind both source and logical focus before a modal can take over DOM selection. */
export function tableConversionAction(target:TableActionTarget,options:TableEditingOptions,checkLifecycle:()=>void=()=>{}):()=>Promise<void> {
	const session=target.session,bookmark=target.focusBookmark;
	const check=()=>{checkLifecycle();if(!options.isActive(target.view)||options.isActiveView?.(target.view)===false)throw new Error('表格编辑目标已变化，请重新选择。');session.assertCurrent(target.view.state);};
	return async()=>{
		check();
		if(session.target.kind==='markdown'){target.replaceSource(session.serialize(session.table,false),undefined,bookmark);return;}
		const plan=planHtmlToMarkdown(session.target.source,'native');
		if(plan.losses.length){
			if(!options.confirmConversion)throw new Error('Table conversion confirmation is not configured.');
			if(!await options.confirmConversion(plan.losses))return;
			check();
		}
		const offset=plan.headerAdded?1:0,cell={row:bookmark.cell.row+offset,column:bookmark.cell.column};
		const model=htmlToGrid(markdownToHtml(plan.markdown)).table.cells.find(candidate=>candidate.row===cell.row&&candidate.column===cell.column)!;
		const plain=createDetachedEl(target.view.dom.ownerDocument, 'div');plain.append(admittedFragment(plain.ownerDocument,model.html));const text=plain.textContent??'';
		// A lossy inline rewrite can change text offsets. Keep its cell and choose its start.
		const offsets=text===bookmark.text?{from:bookmark.from,to:bookmark.to}:{from:0,to:0};
		const rectangle=bookmark.rectangle?{...bookmark.rectangle,top:bookmark.rectangle.top+offset,bottom:bookmark.rectangle.bottom+offset}:undefined;
		target.replaceSource(plan.markdown,undefined,{cell,text,...offsets,rectangle});
	};
}
