import {captureTableActionTarget,type TableActionTarget} from './action-target';
import type {TableEditingOptions} from './editing-types';
import {beginTableActions,tableContextItems} from './table-actions';

export function showTableContextMenu(target:TableActionTarget,options:TableEditingOptions,point:{x:number;y:number},onClose?:()=>void):{close:()=>void} {
	target=captureTableActionTarget(target);
	const lifecycle=beginTableActions(target);
	const check=()=>{if(lifecycle.cancelled||!options.isActive(target.view)||options.isActiveView?.(target.view)===false)throw new Error('表格操作目标已变化，请重新选择。');target.session.assertCurrent(target.view.state);};
	const popup=options.showMenu!(target.view.dom.ownerDocument,point,tableContextItems(target,options,check),()=>{target.clearPreview();onClose?.();},options.renderMenuIcon);lifecycle.close=popup.close;return popup;
}
