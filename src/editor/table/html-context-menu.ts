import {captureTableActionTarget,type TableActionTarget} from './action-target';
import type {TableEditingOptions} from './editing-types';
import {beginTableActions,tableContextItems} from './table-actions';
import {tableLinkMenuItems} from './link-actions';

export function showTableContextMenu(target:TableActionTarget,options:TableEditingOptions,point:{x:number;y:number},onClose?:()=>void,linkTarget:string|null=null):{close:()=>void} {
	target=captureTableActionTarget(target);
	const lifecycle=beginTableActions(target);
	const check=()=>{if(lifecycle.cancelled||!options.isActive(target.view)||options.isActiveView?.(target.view)===false)throw new Error('表格操作目标已变化，请重新选择。');target.session.assertCurrent(target.view.state);};
	const links=tableLinkMenuItems(target.view,linkTarget,options),items=tableContextItems(target,options,check);
	const popup=options.showMenu!(target.view.dom.ownerDocument,point,[...links,...items.map((item,index)=>links.length&&index===0?{...item,separatorBefore:true}:item)],()=>{target.clearPreview();onClose?.();},options.renderMenuIcon);lifecycle.close=popup.close;return popup;
}
