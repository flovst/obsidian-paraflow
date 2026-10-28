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
import {moveTableTracks} from './track-movement';
import type {RowStructureChange} from './group-reconciliation';
import {alignMarkdownColumns,deleteMarkdownTracks,formatMarkdownTable,insertMarkdownTrack} from './toolbar-source';
import type {TableFocusBookmark} from './focus-handoff';
import {tableMergeActions} from './merge-actions';
import {tableSourceActions} from './source-actions';
import {clearNativeTextMenu} from './native-text-actions';
import {duplicateTracks} from './reordering';
import {sortTableRows} from './sorting';
import {tableTextActions} from './text-actions';
import {textFormatTarget} from './text-format-target';

const activeActions=new WeakMap<EditorView,{close:()=>void;target:TableActionTarget;cancelled:boolean}>();

export function beginTableActions(target:TableActionTarget):{close:()=>void;target:TableActionTarget;cancelled:boolean} {
	clearTableActions(target.view);const lifecycle={close:()=>{},target,cancelled:false};activeActions.set(target.view,lifecycle);return lifecycle;
}

export function clearTableActions(view:EditorView):void {
	clearNativeTextMenu(view);
	const active=activeActions.get(view);if(!active)return;active.cancelled=true;active.close();active.target.clearPreview();activeActions.delete(view);
}

export function buildTableActions(target:TableActionTarget,options:TableEditingOptions,check:()=>void):{format:TableMenuItem[];actions:TableMenuItem[]} {
	const session=target.session;const table=session.table;const positions=[...target.positions];const rectangle={...target.rectangle};const tracks={...target.trackRectangle};const bookmark=target.focusBookmark.rectangle?null:target.textBookmark;
	const selected=table.cells.filter(cell=>positions.some(position=>cell.row===position.row&&cell.column===position.column));
	const textMode=!!bookmark||!target.focusBookmark.rectangle;
	const replaceSource=(source:string,change?:RowStructureChange,focus?:TableFocusBookmark)=>target.replaceSource(source&&session.target.kind==='markdown'&&!session.target.container?formatMarkdownTable(source):source,change,focus);
	const movementTarget={...target,replaceSource};
	const run=(action:()=>void|Promise<void>,mutates=true)=>()=>{try{check();if(mutates&&target.view.state.readOnly)return;void Promise.resolve(action()).catch(error=>options.notify(error instanceof Error?error.message:String(error)));}catch(error){options.notify(error instanceof Error?error.message:String(error));}};
	const apply=(next:TableModel|null,structural=false,change?:RowStructureChange)=>{check();if(next&&!structural&&textMode)target.replaceSource(session.target.kind==='markdown'?session.serializeAction(next,false):session.serialize(next,false),change,target.focusBookmark);else target.commit(next,structural,change);if(bookmark&&!structural&&next)target.restoreTextSelection(bookmark);};
	const insert=(axis:TableAxis,index:number)=>{const change=axis==='row'?{kind:'insert' as const,index}:undefined;if(session.target.kind==='markdown')replaceSource(insertMarkdownTrack(session.target.source,axis,index),change,{cell:{row:axis==='row'?index:target.focusBookmark.cell.row,column:axis==='column'?index:0},from:0,to:0,text:''});else apply(insertTrack(table,axis,index),true,change);};
	const remove=(axis:TableAxis,first:number,last:number)=>{
		const change=axis==='row'?{kind:'delete' as const,index:first,count:last-first+1}:undefined;
		let next:TableModel|null=table;for(let index=last;index>=first&&next;index--)next=deleteTrack(next,axis,index);
		if(session.target.kind==='markdown'){
			let focus:TableFocusBookmark|undefined;
			if(next){const position={row:Math.min(target.focusBookmark.cell.row,next.rows-1),column:Math.min(target.focusBookmark.cell.column,next.columns-1)},cell=next.cells.find(cell=>cell.row===position.row&&cell.column===position.column)!;focus={cell:position,from:0,to:0,text:admittedFragment(target.view.dom.ownerDocument,cell.html).textContent??''};}
			replaceSource(deleteMarkdownTracks(session.target.source,axis,first,last),change,focus);
		}else apply(next,true,change);
	};
	const textCell=(format?:ToggleFormat|'highlight')=>{
		const focus=bookmark??target.focusBookmark;
		const cell=table.cells.find(cell=>cell.row===focus.cell.row&&cell.column===focus.cell.column)!;
		const element=target.view.dom.ownerDocument.createElement(cell.role);element.append(admittedFragment(target.view.dom.ownerDocument,cell.html));
		element.setAttribute('style',Object.entries(cell.style).map(([property,value])=>`${property}:${value}`).join(';'));
		const selectedBookmark=focus.from===focus.to&&format?textFormatTarget(element,focus,format==='highlight'?'highlight:':format):focus;
		return {cell,element,range:selectedBookmark?rangeFromBookmark(element,selectedBookmark):null};
	};
	const textAction=(action:Parameters<typeof formatTextRange>[2]):TableModel=>{
		const {cell,element,range}=textCell(action.type==='toggle'?action.format:undefined);if(!range)throw new Error('请选择文字');
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
		let checked:'on'|'off'|'mixed';if(textMode){const {element,range}=textCell(format);checked=range?getTextToggleState(element,range,format):'off';}else checked=getCellToggleState(selected,format);
		const next=()=>textMode?textAction({type:'toggle',format}):applyCellToggle(table,positions,format);
		const disabled=textMode&&!textCell(format).range;
		return {label,icon:format,checked,disabled,disabledReason:disabled?'请选择文字':undefined,preview:()=>target.preview(next()),run:run(()=>apply(next()))};
	});
	formatItems.push({label:'高亮',icon:'highlighter',children:([['','默认'],['red','红色'],['orange','橙色'],['yellow','黄色'],['green','绿色'],['blue','蓝色'],['purple','紫色']] as const).map(([color,label])=>{
		const next=()=>textMode?textAction({type:'toggle',format:'highlight',color}):{...table,cells:table.cells.map(cell=>{
			if(!positions.some(position=>cell.row===position.row&&cell.column===position.column))return cell;
			const element=target.view.dom.ownerDocument.createElement(cell.role);element.append(admittedFragment(element.ownerDocument,cell.html));if(!element.textContent)return cell;const range=element.ownerDocument.createRange();range.selectNodeContents(element);formatTextRange(element,range,{type:'toggle',format:'highlight',color});return {...cell,html:element.innerHTML};
		})};
		return {label,icon:'highlighter',preview:()=>target.preview(next()),run:run(()=>apply(next()))};
	})});
	if(!textMode){
		const cellContents=selected.map(cell=>{const element=target.view.dom.ownerDocument.createElement(cell.role);element.append(admittedFragment(element.ownerDocument,cell.html));return {cell,element};});
		const textNodes=(element:HTMLElement)=>{const walker=element.ownerDocument.createTreeWalker(element,4),nodes:Text[]=[];for(let node=walker.nextNode();node;node=walker.nextNode())if(node.textContent)nodes.push(node as Text);return nodes;};
		const nodes=cellContents.flatMap(({element})=>textNodes(element));
		const codeEnabled=nodes.length>0&&nodes.every(node=>node.parentElement!.closest('code'));
		const nextCode=()=>({...table,cells:table.cells.map(cell=>{
			const content=cellContents.find(content=>content.cell===cell);if(!content)return cell;
			const element=content.element.cloneNode(true) as HTMLElement;
			if(codeEnabled)for(const code of Array.from(element.querySelectorAll('code')))code.replaceWith(...Array.from(code.childNodes));
			else for(const node of textNodes(element)){if(node.parentElement!.closest('code'))continue;const code=element.ownerDocument.createElement('code');node.replaceWith(code);code.append(node);}
			return {...cell,html:element.innerHTML};
		})});
		formatItems.push({label:'行内代码',icon:'code',separatorBefore:true,checked:codeEnabled?'on':'off',disabled:nodes.length===0,disabledReason:nodes.length===0?'所选单元格为空':undefined,preview:()=>target.preview(nextCode()),run:run(()=>apply(nextCode()))});
	}
	const cellItems:TableMenuItem[]=[];
	for(const [property,label,kind,initial] of [
		['font-family','字体…','font','inherit'],['font-size','字号…','size','16px'],['color','字体颜色…','color',''],['background-color','背景颜色…','color',''],
	] as const){
		(property==='background-color'?cellItems:formatItems).push({label,separatorBefore:property==='font-family',icon:property==='font-family'?'type':property==='font-size'?'a-large-small':property==='color'?'palette':'paint-bucket',run:run(async()=>{
			const next=(value:string)=>bookmark&&property!=='background-color'?textAction({type:'style',property,value}):applyCellStyle(table,positions,property,value);
			const value=await options.requestValue({title:label.replace('…',''),kind,initial:selected[0]?.style[property]??initial,
				preview:value=>{check();target.preview(next(value));},clearPreview:()=>target.clearPreview()});
			target.clearPreview();if(value!==null)apply(next(value));
		})});
	}
	const reset=()=>resetCellStyles(table,positions);
	cellItems.push({label:'重置单元格样式',icon:'rotate-ccw',preview:()=>target.preview(reset()),run:run(()=>apply(reset()))});
	const alignCells=([['left','单元格左对齐'],['center','单元格居中'],['right','单元格右对齐']] as const).map(([value,label])=>{
		const next=()=>applyCellStyle(table,positions,'text-align',value);return {label,icon:'align-'+value,preview:()=>target.preview(next()),run:run(()=>apply(next()))};
	});
	const trackFormat=(axis:TableAxis):TableMenuItem[]=>(['th','td'] as const).map(role=>{
		const next=()=>formatTracks(table,axis,axis==='row'?tracks.top:tracks.left,axis==='row'?tracks.bottom:tracks.right,role);
		return {label:`设为${role==='th'?'表头':'正文'}${axis==='row'?'行':'列'}`,icon:role==='th'?'heading':'text',preview:()=>target.preview(next()),run:run(()=>apply(next()))};
	});
	const trackItems:TableMenuItem[]=[
		...(target.selectTracks?[{label:'选择整行',icon:'rows-3',run:run(()=>target.selectTracks!('row'),false)},{label:'选择整列',icon:'columns-3',run:run(()=>target.selectTracks!('column'),false)}]:[]),
			{label:'在上方插入行',icon:'between-horizontal-start',run:run(()=>insert('row',rectangle.top))},
			{label:'在下方插入行',icon:'between-horizontal-end',shortcut:rectangle.top===rectangle.bottom?'Ctrl+Enter':undefined,run:run(()=>insert('row',rectangle.bottom+1))},
			{label:'在左侧插入列',icon:'between-vertical-start',run:run(()=>insert('column',rectangle.left))},
			{label:'在右侧插入列',icon:'between-vertical-end',run:run(()=>insert('column',rectangle.right+1))},
		{label:'向上移动行',icon:'arrow-up',shortcut:'Alt+↑',separatorBefore:true,disabled:tracks.top===0,run:run(()=>moveTableTracks(movementTarget,'row',-1))},
		{label:'向下移动行',icon:'arrow-down',shortcut:'Alt+↓',disabled:tracks.bottom===table.rows-1,run:run(()=>moveTableTracks(movementTarget,'row',1))},
		{label:'向左移动列',icon:'arrow-left',shortcut:'Alt+←',disabled:tracks.left===0,run:run(()=>moveTableTracks(movementTarget,'column',-1))},
		{label:'向右移动列',icon:'arrow-right',shortcut:'Alt+→',disabled:tracks.right===table.columns-1,run:run(()=>moveTableTracks(movementTarget,'column',1))},
		...(['row','column'] as const).map(axis=>({label:axis==='row'?'创建行副本':'创建列副本',icon:'copy',separatorBefore:axis==='row',run:run(()=>{
			const first=axis==='row'?tracks.top:tracks.left,last=axis==='row'?tracks.bottom:tracks.right,change=axis==='row'?{kind:'duplicate' as const,first,last}:undefined;
			const next=duplicateTracks(table,axis,first,last);target.replaceSource(session.target.kind==='markdown'?session.serializeAction(next,true,change):session.serialize(next,true,change),change);
		})})),
		{label:'删除行',icon:'rows-3',shortcut:rectangle.top===rectangle.bottom?'Ctrl+Shift+Backspace':undefined,run:run(()=>remove('row',rectangle.top,rectangle.bottom))},
		{label:'删除列',icon:'columns-3',run:run(()=>remove('column',rectangle.left,rectangle.right))},
		...trackFormat('row').map((item,index)=>({...item,separatorBefore:index===0})),...trackFormat('column'),
		...([['left','整列左对齐'],['center','整列居中'],['right','整列右对齐']] as const).map(([value,label])=>{
			const alignmentPositions=table.cells.filter(cell=>cell.column<=tracks.right&&cell.column+cell.columnSpan>tracks.left);
			const disabledReason=alignmentPositions.some(cell=>cell.column<tracks.left||cell.column+cell.columnSpan-1>tracks.right)?'请选中完整合并列范围，或先取消合并。':undefined;
			const next=()=>applyCellStyle(table,alignmentPositions,'text-align',value);
			return {label,icon:'align-'+value,separatorBefore:value==='left',disabled:!!disabledReason,disabledReason,preview:()=>target.preview(next()),run:run(()=>{if(session.target.kind==='markdown')replaceSource(alignMarkdownColumns(session.target.source,tracks.left,tracks.right,value));else apply(next());})};
		}),
	];
	if(target.selectTracks)trackItems[2]!.separatorBefore=true;
	const sortItems=([1,-1] as const).map(direction=>{
		const label=direction===1?'按当前列升序（A–Z）':'按当前列降序（Z–A）',icon=direction===1?'arrow-down-az':'arrow-up-za';
		try{const sorted=sortTableRows(session.envelope,target.focusBookmark.cell.column,direction,target.view.dom.ownerDocument);return {label,icon,run:run(()=>{
			const change={kind:'sort' as const,origins:sorted.origins};const focus={...target.focusBookmark,cell:{...target.focusBookmark.cell,row:sorted.origins.indexOf(target.focusBookmark.cell.row)},rectangle:undefined};
			target.replaceSource(session.target.kind==='markdown'?session.serializeAction(sorted.table,true,change):session.serialize(sorted.table,true,change),change,focus);
		})};}catch(error){return {label,icon,disabled:true,disabledReason:error instanceof Error?error.message:String(error)};}
	});
	const sourceActions=tableSourceActions(target.view,session.target,options,null,target,check);
	const actions:TableMenuItem[]=[
		{label:'行列操作',icon:'move',children:trackItems},
		{label:'单元格',icon:'table-cells-merge',children:[...tableMergeActions(target,options,check),...alignCells.map((item,index)=>({...item,separatorBefore:index===0})),...cellItems.map((item,index)=>({...item,separatorBefore:index===0}))]},
		{label:'排序',icon:'arrow-down-az',children:sortItems},
		...(options.getAutoWrap&&options.setAutoWrap?[{label:'表格自动换行',icon:'wrap-text',checked:options.getAutoWrap()?'on' as const:'off' as const,run:run(()=>options.setAutoWrap!(!options.getAutoWrap!()),false)}]:[]),
		sourceActions[0]!,
		{label:'复制为 HTML 源码',icon:'code-xml',run:run(()=>options.writeClipboard(session.serialize(table,false)),false)},
		sourceActions[1]!,
		{label:session.target.kind==='markdown'?'转换为 HTML 表格':'转换为 Markdown 表格',icon:'arrow-right-left',run:run(tableConversionAction(target,options,check))},
		{label:'删除表格',icon:'trash-2',run:run(()=>apply(null,true))},
	];
	const readOnlyItems=(list:readonly TableMenuItem[]):TableMenuItem[]=>list.map(item=>item.children?{...item,children:readOnlyItems(item.children)}:['复制表格源码','复制为 HTML 源码','选择整行','选择整列','表格自动换行'].includes(item.label)?item:{...item,disabled:true,disabledReason:'文档只读'});
	return {format:target.view.state.readOnly?readOnlyItems(formatItems):formatItems,actions:target.view.state.readOnly?readOnlyItems(actions):actions};
}
export function tableActionItems(target:TableActionTarget,options:TableEditingOptions,check:()=>void):TableMenuItem[] {return buildTableActions(target,options,check).actions;}

/** Cell text and rectangle formats share one visible entry and retain their own target. */
export function tableContextItems(target:TableActionTarget,options:TableEditingOptions,check:()=>void):TableMenuItem[] {
	const text=tableTextActions(target,options,check),parts=buildTableActions(target,options,check);
	const formatIndex=text.findIndex(item=>item.label==='文本格式'),format=text[formatIndex]!;
	const rectangle=target.focusBookmark.rectangle;
	const selectedCells=!!rectangle;
	const existing=[...format.children!];
	const nativeText=target.session.target.kind==='markdown'&&!target.session.target.container&&!!options.getNativeCellEditor&&!!target.cellElement(target.focusBookmark.cell);
	const extras=parts.format.filter(item=>['下划线','字体…','字号…','字体颜色…'].includes(item.label));
	if(selectedCells){
		const clearCells=()=>{check();if(target.view.state.readOnly)return;const table=target.session.table;const next={...table,cells:table.cells.map(cell=>{
			if(!target.positions.some(position=>cell.row===position.row&&cell.column===position.column))return cell;
			const element=target.view.dom.ownerDocument.createElement(cell.role);element.append(admittedFragment(element.ownerDocument,cell.html));const range=element.ownerDocument.createRange();range.selectNodeContents(element);if(element.textContent)formatTextRange(element,range,{type:'reset',includeCode:true});const style={...cell.style};for(const key of Object.keys(style))if(['font-weight','font-style','font-family','font-size','color'].includes(key)||key.startsWith('text-decoration'))delete style[key];return {...cell,html:element.innerHTML,style};
		})};target.commit(next);};
		text[formatIndex]={...format,label:'所选单元格格式',children:[...parts.format,{label:'清除文本格式',icon:'eraser',separatorBefore:true,disabled:target.view.state.readOnly,run:clearCells}]};
	}else{
		const underline=extras.find(item=>item.label==='下划线')!;existing.splice(3,0,underline);
		if(!nativeText)for(let index=0;index<3;index++)existing[index]=parts.format[index]!;
		existing.splice(existing.length-1,0,...extras.filter(item=>item!==underline));
		text[formatIndex]={...format,children:existing.filter(item=>nativeText||!['行内公式','注释'].includes(item.label))};
	}
	return [...text,...parts.actions.map((item,index)=>({...item,separatorBefore:index===0}))];
}
export function showTableActions(target:TableActionTarget,options:TableEditingOptions,point:{x:number;y:number},onClose?:()=>void):{close:()=>void} {
	target=captureTableActionTarget(target);const lifecycle=beginTableActions(target);
	const check=()=>{if(lifecycle.cancelled||!options.isActive(target.view)||options.isActiveView?.(target.view)===false)throw new Error('表格操作目标已变化，请重新选择。');target.session.assertCurrent(target.view.state);};
	const popup=options.showMenu!(target.view.dom.ownerDocument,point,tableActionItems(target,options,check),()=>{target.clearPreview();onClose?.();},options.renderMenuIcon);lifecycle.close=popup.close;return popup;
}
