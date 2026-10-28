import {EditorView} from '@codemirror/view';
import type {TableEditingOptions} from './editing-types';
import type {TableSource} from './edit-session';
import type {TableMenuItem} from './popup';
import {nativeTableTextActions} from './native-text-actions';
import {tableSourceActions} from './source-actions';

interface NativeMenuCell {el:HTMLElement;}
interface NativeMenuTable {
	containerEl:HTMLElement;rows:NativeMenuCell[][];
	makeRowMenu(menu:CollectedMenu,cell:NativeMenuCell):void;
	makeColMenu(menu:CollectedMenu,cell:NativeMenuCell):void;
	makeSortMenu(menu:CollectedMenu,cell:NativeMenuCell):void;
}
/** Records the observed native table builder's actions; the host Menu still renders them. */
class CollectedMenu {
	readonly items:TableMenuItem[]=[];
	constructor(private readonly check:()=>void,private readonly options:TableEditingOptions,private readonly readOnly:()=>boolean){}
	addItem(build:(item:CollectedMenuItem)=>void):this {const item=new CollectedMenuItem(this.check,this.options,this.readOnly);build(item);this.items.push(item.action);return this;}
}
class CollectedMenuItem {
	readonly action:TableMenuItem={label:''};
	constructor(private readonly check:()=>void,private readonly options:TableEditingOptions,private readonly readOnly:()=>boolean){if(readOnly()){this.action.disabled=true;this.action.disabledReason='文档只读';}}
	setTitle(title:string):this {this.action.label=title;return this;}
	setIcon(icon:string):this {this.action.icon=icon;return this;}
	setSection(_section:string):this {return this;}
	setDisabled(disabled:boolean):this {this.action.disabled=disabled||this.readOnly();return this;}
	setChecked(checked:boolean):this {this.action.checked=checked?'on':'off';return this;}
	onClick(callback:()=>void):this {this.action.run=()=>{try{this.check();if(!this.readOnly())callback();}catch(error){this.options.notify(error instanceof Error?error.message:String(error));}};return this;}
}

/** Unsupported HTML-model syntax must not remove any native Markdown command. */
export function nativeSourceMenu(view:EditorView,source:TableSource,cell:HTMLElement|null,options:TableEditingOptions,objectOnly=false):TableMenuItem[] {
	const sourceActions=tableSourceActions(view,source,options,cell);if(!cell)return sourceActions;
	const doc=view.state.doc;
	const check=()=>{if(view.state.doc!==doc||!options.isActive(view)||options.isActiveView?.(view)===false||!cell.isConnected||!view.dom.contains(cell))throw new Error('表格操作目标已变化，请重新选择。');};
	let native:NativeMenuTable|undefined;
	for(const decorations of view.state.facet(EditorView.decorations)){
		if(typeof decorations==='function')continue;
		for(let cursor=decorations.iter();cursor.value;cursor.next()){
			const widget=(cursor.value.spec as {widget?:Partial<NativeMenuTable>}).widget;
			if(widget?.containerEl===cell.closest('.cm-table-widget')&&Array.isArray(widget.rows)&&typeof widget.makeRowMenu==='function'&&typeof widget.makeColMenu==='function'&&typeof widget.makeSortMenu==='function')native=widget as NativeMenuTable;
		}
	}
	const nativeCell=native?.rows.flat().find(candidate=>candidate.el===cell);
	const tableItems:TableMenuItem[]=[];
	if(native&&nativeCell){
		const tracks:TableMenuItem[]=[];
		for(const method of ['makeRowMenu','makeColMenu'] as const){const menu=new CollectedMenu(check,options,()=>view.state.readOnly);native[method](menu,nativeCell);tracks.push(...menu.items.map((item,index)=>({...item,separatorBefore:method==='makeColMenu'&&index===0})));}
		tableItems.push({label:'行列操作',icon:'move',children:tracks});
		const menu=new CollectedMenu(check,options,()=>view.state.readOnly);native.makeSortMenu(menu,nativeCell);tableItems.push({label:'排序',icon:'arrow-down-az',children:menu.items});
	}
	const reason='合并操作需要支持当前单元格语法的增强表格模型。';
	const actions:TableMenuItem[]=[...tableItems.slice(0,1),{label:'单元格',icon:'table-cells-merge',children:[{label:'合并单元格',icon:'combine',disabled:true,disabledReason:reason},{label:'取消合并',icon:'split',disabled:true,disabledReason:reason}]},...tableItems.slice(1),
		...(options.getAutoWrap&&options.setAutoWrap?[{label:'表格自动换行',icon:'wrap-text',checked:options.getAutoWrap()?'on' as const:'off' as const,run:()=>{check();void options.setAutoWrap!(!options.getAutoWrap!()).catch(error=>options.notify(String(error)));}}]:[]),...sourceActions];
	return objectOnly?actions:[...nativeTableTextActions(view,cell,options,check),...actions.map((item,index)=>({...item,separatorBefore:index===0}))];
}
