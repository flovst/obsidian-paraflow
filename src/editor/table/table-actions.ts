import {tableConversionAction} from './conversion-action';
import {admittedFragment} from './admitted-dom';
import type {TableActionTarget} from './action-target';
import {captureTableActionTarget,rangeFromBookmark} from './action-target';
import type {TableEditingOptions} from './editing-types';
import {applyCellStyle,applyCellToggle,formatTextRange,getCellToggleState,getTextToggleState,type ToggleFormat} from './formatting';
import type {TableModel,TableAxis} from './model';
import {deleteTrack,formatTracks,insertTrack,resetCellStyles} from './operations';
import type {TableMenuItem} from './popup';
import type {EditorView} from '@codemirror/view';
import {moveTracks} from './reordering';
import type {RowStructureChange} from './group-reconciliation';
import {alignMarkdownColumns,deleteMarkdownTracks,insertMarkdownTrack,moveMarkdownTracks} from './toolbar-source';
import {tableMergeActions} from './merge-actions';
import {tableSourceActions} from './source-actions';
import {clearNativeTextMenu} from './native-text-actions';

const activeActions=new WeakMap<EditorView,{close:()=>void;target:TableActionTarget;cancelled:boolean}>();

export function beginTableActions(target:TableActionTarget):{close:()=>void;target:TableActionTarget;cancelled:boolean} {
	clearTableActions(target.view);const lifecycle={close:()=>{},target,cancelled:false};activeActions.set(target.view,lifecycle);return lifecycle;
}

export function clearTableActions(view:EditorView):void {
	clearNativeTextMenu(view);
	const active=activeActions.get(view);if(!active)return;active.cancelled=true;active.close();active.target.clearPreview();activeActions.delete(view);
}

export function showTableActions(target:TableActionTarget,options:TableEditingOptions,point:{x:number;y:number},onClose?:()=>void):{close:()=>void} {
	target=captureTableActionTarget(target);
	const lifecycle=beginTableActions(target);
	const session=target.session;const table=session.table;const positions=[...target.positions];const rectangle={...target.rectangle};const tracks={...target.trackRectangle};const bookmark=target.textBookmark;
	const selected=table.cells.filter(cell=>positions.some(position=>cell.row===position.row&&cell.column===position.column));
	const check=()=>{if(lifecycle.cancelled||!options.isActive(target.view))throw new Error('表格操作目标已变化，请重新选择。');session.assertCurrent(target.view.state);};
	const run=(action:()=>void|Promise<void>)=>()=>{void Promise.resolve().then(()=>{check();return action();}).catch(error=>options.notify(error instanceof Error?error.message:String(error)));};
	const apply=(next:TableModel|null,structural=false,change?:RowStructureChange)=>{check();target.commit(next,structural,change);if(bookmark&&!structural&&next)target.restoreTextSelection(bookmark);};
	const insert=(axis:TableAxis,index:number)=>{const change=axis==='row'?{kind:'insert' as const,index}:undefined;if(session.target.kind==='markdown')target.replaceSource(insertMarkdownTrack(session.target.source,axis,index),change);else apply(insertTrack(table,axis,index),true,change);};
	const remove=(axis:TableAxis,first:number,last:number)=>{const change=axis==='row'?{kind:'delete' as const,index:first,count:last-first+1}:undefined;if(session.target.kind==='markdown')target.replaceSource(deleteMarkdownTracks(session.target.source,axis,first,last),change);else {let next:TableModel|null=table;for(let index=last;index>=first&&next;index--)next=deleteTrack(next,axis,index);apply(next,true,change);}};
	const move=(axis:TableAxis,first:number,last:number,direction:-1|1)=>{const change=axis==='row'?{kind:'move' as const,first,last,direction}:undefined;if(session.target.kind==='markdown')target.replaceSource(moveMarkdownTracks(session.target.source,axis,first,last,first+direction),change);else apply(moveTracks(table,axis,first,last,direction),true,change);};
	const textCell=()=>{
		const cell=table.cells.find(cell=>bookmark&&cell.row===bookmark.cell.row&&cell.column===bookmark.cell.column)!;
		const element=target.view.dom.ownerDocument.createElement(cell.role);element.append(admittedFragment(target.view.dom.ownerDocument,cell.html));
		element.setAttribute('style',Object.entries(cell.style).map(([property,value])=>`${property}:${value}`).join(';'));
		return {cell,element,range:rangeFromBookmark(element,bookmark!)};
	};
	const textAction=(action:Parameters<typeof formatTextRange>[2]):TableModel=>{
		const {cell,element,range}=textCell();
		const cssValue=(property:string)=>element.style.getPropertyValue(property)+(element.style.getPropertyPriority(property)?' !important':'');
		const before=new Map(Array.from(element.style).map(property=>[property,cssValue(property)]));formatTextRange(element,range,action);
		const style={...cell.style};
		const owned=(property:string)=>['font-weight','font-style','text-decoration','font-family','font-size','color','background-color'].includes(property)||property.startsWith('text-decoration-');
		for(const property of new Set([...before.keys(),...Array.from(element.style)])){
			if(!owned(property)||(before.get(property)??'')===cssValue(property))continue;
			if(cssValue(property))style[property]=cssValue(property);else delete style[property];
		}
		return {...table,cells:table.cells.map(candidate=>candidate===cell?{...cell,html:element.innerHTML,style}:candidate)};
	};
	const toggles:readonly [ToggleFormat,string][]=[['bold','加粗'],['italic','斜体'],['strikethrough','删除线'],['underline','下划线']];
	const formatItems:TableMenuItem[]=toggles.map(([format,label])=>{
		let checked:'on'|'off'|'mixed';if(bookmark){const {element,range}=textCell();checked=getTextToggleState(element,range,format);}else checked=getCellToggleState(selected,format);
		const next=()=>bookmark?textAction({type:'toggle',format}):applyCellToggle(table,positions,format);
		return {label,checked,preview:()=>target.preview(next()),run:run(()=>apply(next()))};
	});
	for(const [property,label,kind,initial] of [
		['font-family','字体…','font','inherit'],['font-size','字号…','size','16px'],['color','字体颜色…','color',''],['background-color','背景颜色…','color',''],
	] as const){
		formatItems.push({label,run:run(async()=>{
			const next=(value:string)=>bookmark&&property!=='background-color'?textAction({type:'style',property,value}):applyCellStyle(table,positions,property,value);
			const value=await options.requestValue({title:label.replace('…',''),kind,initial:selected[0]?.style[property]??initial,
				preview:value=>{check();target.preview(next(value));},clearPreview:()=>target.clearPreview()});
			target.clearPreview();if(value!==null)apply(next(value));
		})});
	}
	const reset=()=>bookmark?textAction({type:'reset'}):resetCellStyles(table,positions);
	formatItems.push({label:'恢复默认',preview:()=>target.preview(reset()),run:run(()=>apply(reset()))});
	formatItems.push({label:'单元格对齐',children:([['left','左对齐'],['center','居中对齐'],['right','右对齐']] as const).map(([value,label])=>{
		const next=()=>applyCellStyle(table,positions,'text-align',value);return {label,preview:()=>target.preview(next()),run:run(()=>apply(next()))};
	})});
	const trackFormat=(axis:TableAxis):TableMenuItem=>({label:axis==='row'?'行格式':'列格式',children:(['th','td'] as const).map(role=>{
		const next=()=>formatTracks(table,axis,axis==='row'?tracks.top:tracks.left,axis==='row'?tracks.bottom:tracks.right,role);
		return {label:role==='th'?'表头':'正文',preview:()=>target.preview(next()),run:run(()=>apply(next()))};
	})});
	const items:TableMenuItem[]=[
		...tableSourceActions(target.view,session.target,options,null,target,check),
		...(options.getAutoWrap&&options.setAutoWrap?[{label:'表格自动换行',checked:options.getAutoWrap()?'on' as const:'off' as const,run:run(()=>options.setAutoWrap!(!options.getAutoWrap!()))}]:[]),
		...tableMergeActions(target,options,check),
		{label:'插入',children:[
			{label:'在上方插入行',run:run(()=>insert('row',rectangle.top))},
			{label:'在下方插入行',run:run(()=>insert('row',rectangle.bottom+1))},
			{label:'在左侧插入列',run:run(()=>insert('column',rectangle.left))},
			{label:'在右侧插入列',run:run(()=>insert('column',rectangle.right+1))},
		]},
		{label:'删除',children:[
			{label:'删除所选行',run:run(()=>remove('row',rectangle.top,rectangle.bottom))},
			{label:'删除所选列',run:run(()=>remove('column',rectangle.left,rectangle.right))},
			{label:'删除表格',run:run(()=>apply(null,true))},
		]},trackFormat('row'),trackFormat('column'),{label:'格式',children:formatItems},
		{label:'文字对齐',children:([['left','靠左'],['center','居中'],['right','靠右']] as const).map(([value,label])=>{
			const alignmentPositions=table.cells.filter(cell=>cell.column<=tracks.right&&cell.column+cell.columnSpan>tracks.left);
			const disabledReason=alignmentPositions.some(cell=>cell.column<tracks.left||cell.column+cell.columnSpan-1>tracks.right)?'请选中完整合并列范围，或先取消合并。':undefined;
			const next=()=>applyCellStyle(table,alignmentPositions,'text-align',value);
			return {label,disabled:!!disabledReason,disabledReason,preview:()=>target.preview(next()),run:run(()=>{if(session.target.kind==='markdown')target.replaceSource(alignMarkdownColumns(session.target.source,tracks.left,tracks.right,value));else apply(next());})};
		})},
		{label:session.target.kind==='markdown'?'转换为 HTML 表格':'转换为 Markdown 格式',run:run(tableConversionAction(target,options,check))},
		{label:'复制整表 HTML 源码',run:run(()=>options.writeClipboard(session.serialize(table,false)))},
	];
	if(target.selectTracks)items.unshift({label:'选择整行',run:()=>target.selectTracks!('row')},{label:'选择整列',run:()=>target.selectTracks!('column')});
	items.splice(3,0,{label:'移动行列',children:[
		{label:'行上移',disabled:tracks.top===0,run:run(()=>move('row',tracks.top,tracks.bottom,-1))},
		{label:'行下移',disabled:tracks.bottom===table.rows-1,run:run(()=>move('row',tracks.top,tracks.bottom,1))},
		{label:'列左移',disabled:tracks.left===0,run:run(()=>move('column',tracks.left,tracks.right,-1))},
		{label:'列右移',disabled:tracks.right===table.columns-1,run:run(()=>move('column',tracks.left,tracks.right,1))},
	]});
	const menuItems=items;
	const readOnlyItems=(list:readonly TableMenuItem[]):TableMenuItem[]=>list.map(item=>item.children?{...item,children:readOnlyItems(item.children)}:['复制表格','复制整表 HTML 源码','选择整行','选择整列','表格自动换行'].includes(item.label)?item:{...item,disabled:true,disabledReason:'文档只读'});
	const popup=options.showMenu!(target.view.dom.ownerDocument,point,target.view.state.readOnly?readOnlyItems(menuItems):menuItems,()=>{target.clearPreview();onClose?.();},options.renderMenuIcon);lifecycle.close=popup.close;return popup;
}
