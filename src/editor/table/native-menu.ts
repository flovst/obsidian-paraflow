import type {TableMenuItem,TableMenuPresenter} from './popup';
import {decorateContextMenuItem} from '../menu-shortcuts';

/** Runtime submenu/DOM members are isolated here; Obsidian's public types omit them. */
export interface HostTableMenuItem {
	dom:HTMLElement;
	setTitle(title:string):this;
	setIcon(icon:string):this;
	setDisabled(disabled:boolean):this;
	setChecked(checked:boolean|null):this;
	setSubmenu():HostTableMenu;
	onClick(callback:()=>void):this;
}
export interface HostTableMenu {
	dom?:HTMLElement;
	addItem(callback:(item:HostTableMenuItem)=>void):this;
	addSeparator():this;
	showAtPosition(point:{x:number;y:number},doc?:Document):this;
	onHide(callback:()=>void):void;
	hide():this;
}
const openMenus=new WeakMap<Document,Set<HTMLElement>>();
const dismissMenu=new WeakMap<Document,()=>void>();
export function isTableMenuTarget(node:Node|null):boolean {
	if(!node)return false;return Array.from(openMenus.get(node.ownerDocument!)??[]).some(element=>element.contains(node));
}

export function createNativeTableMenuPresenter(create:()=>HostTableMenu,app?:unknown,translate:(label:string)=>string=label=>label,mac=false):TableMenuPresenter {
	return (doc,point,items,onClose)=>{
		dismissMenu.get(doc)?.();
		const menu=create(),roots=new Set<HTMLElement>(),listeners:Array<()=>void>=[];
		let closed=false,undoPreview:(()=>void)|undefined;
		const clearPreview=()=>{undoPreview?.();undoPreview=undefined;};
		const finish=()=>{if(closed)return;closed=true;clearPreview();for(const release of listeners)release();if(openMenus.get(doc)===roots){openMenus.delete(doc);dismissMenu.delete(doc);}onClose?.();};
		const build=(level:HostTableMenu,list:readonly TableMenuItem[])=>{
			level.dom?.classList.add('paraflow-context-menu');
			for(const action of list){
				if(action.separatorBefore)level.addSeparator();
				level.addItem(item=>{
					roots.add(item.dom);item.setTitle(translate(action.label)).setIcon(action.icon??'table').setDisabled(!!action.disabled);
					if(action.checked)item.setChecked(action.checked==='mixed'?null:action.checked==='on');
					if(action.disabledReason)item.dom.title=translate(action.disabledReason);
					decorateContextMenuItem(item.dom,action,app,mac);
					if(action.children)build(item.setSubmenu(),action.children);
					else item.onClick(()=>{clearPreview();action.run?.();});
					if(action.preview&&!action.disabled){const enter=()=>{clearPreview();undoPreview=action.preview!();};item.dom.addEventListener('pointerenter',enter);item.dom.addEventListener('focusin',enter);item.dom.addEventListener('pointerleave',clearPreview);listeners.push(()=>{item.dom.removeEventListener('pointerenter',enter);item.dom.removeEventListener('focusin',enter);item.dom.removeEventListener('pointerleave',clearPreview);});}
				});
			}
		};
		const close=()=>{if(closed)return;menu.hide();finish();};
		build(menu,items);openMenus.set(doc,roots);dismissMenu.set(doc,close);menu.onHide(finish);menu.showAtPosition(point,doc);
		return {close};
	};
}
