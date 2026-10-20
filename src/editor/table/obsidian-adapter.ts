import {MarkdownView,Menu,Modal,Scope,editorInfoField,requireApiVersion,setIcon,type App,type Command,type View} from 'obsidian';
import type {EditorView} from '@codemirror/view';
import {canEditCurrentTable,createTableEditingExtension,insertNewTable,showCurrentTableMenu} from './extension';
import type {TableEditingOptions,TableValueRequest} from './editing-types';
import {readClipboardData} from '../clipboard-paste';
import {tableErrorMessage} from './error-messages';
import {createNativeTableMenuPresenter,type HostTableMenu} from './native-menu';
import {refreshTableToolbarOwnership} from './focus-toolbar';
import {refreshTableAddControlOwnership} from './add-controls';
import {bindTableCellScope} from './cell-key-scope';
import type {TableConversionLoss} from './markdown-serialization';
import type {NativeCellEditor,NativeClipboardAction} from './native-text-actions';
import {createNativeCellSourceEditing,type NativeSourceCell} from './native-cell-source';

interface NativeEditorOwner {cm:EditorView;editorComponent?:{cm:EditorView;tableCell?:NativeSourceCell&{cell:NativeSourceCell['cell']&{el:HTMLElement};editor:NativeCellEditor}};}
interface ClipboardHostWindow extends Window {electron?:{remote:{getCurrentWebContents:()=>Record<NativeClipboardAction,()=>void>}};}

class ConversionDialog extends Modal {
	private confirmed=false;
	constructor(app:App,private readonly losses:readonly TableConversionLoss[],private readonly done:(confirmed:boolean)=>void){super(app);}
	onOpen():void {
		this.titleEl.textContent='转换为 Markdown 格式';const doc=this.contentEl.ownerDocument;
		const text=doc.createElement('p');text.textContent='转换为 Markdown 时，以下内容需要调整或无法保留。强制转换将应用全部列出的更改；撤销可恢复原始表格。';
		const list=doc.createElement('ul');for(const loss of this.losses){const item=doc.createElement('li');item.textContent=`第 ${loss.row} 行，第 ${loss.column} 列：${loss.message}`;list.append(item);}
		const buttons=doc.createElement('div');buttons.className='paraflow-table-dialog-buttons';const cancel=doc.createElement('button');cancel.textContent='取消';cancel.onclick=()=>this.close();
		const confirm=doc.createElement('button');confirm.textContent='强制转换';confirm.className='mod-cta';confirm.onclick=()=>{this.confirmed=true;this.close();};buttons.append(cancel,confirm);this.contentEl.append(text,list,buttons);cancel.focus();
	}
	onClose():void {this.contentEl.replaceChildren();this.done(this.confirmed);}
}

class FailureDialog extends Modal {
	constructor(app:App,private readonly message:string){super(app);}
	onOpen():void {this.titleEl.textContent='无法完成表格操作';const text=this.contentEl.ownerDocument.createElement('p');text.textContent=this.message;const close=this.contentEl.ownerDocument.createElement('button');close.textContent='关闭';close.onclick=()=>this.close();this.contentEl.append(text,close);close.focus();}
	onClose():void {this.contentEl.replaceChildren();}
}

class MergeDialog extends Modal {
	private result={confirmed:false,suppressWarning:false};
	constructor(app:App,private readonly done:(result:{confirmed:boolean;suppressWarning:boolean})=>void){super(app);}
	onOpen():void {
		this.titleEl.textContent='合并单元格';const doc=this.contentEl.ownerDocument;
		const text=doc.createElement('p');text.textContent='合并单元格时，仅保留左上角的内容，其他单元格的内容将被丢弃。';this.contentEl.append(text);
		const label=doc.createElement('label');label.className='paraflow-table-dialog-check';const check=doc.createElement('input');check.type='checkbox';label.append(check,doc.createTextNode('不再显示'));this.contentEl.append(label);
		const buttons=doc.createElement('div');buttons.className='paraflow-table-dialog-buttons';
		const cancel=doc.createElement('button');cancel.textContent='取消';cancel.onclick=()=>this.close();
		const confirm=doc.createElement('button');confirm.textContent='确定';confirm.className='mod-cta';confirm.onclick=()=>{this.result={confirmed:true,suppressWarning:check.checked};this.close();};buttons.append(cancel,confirm);this.contentEl.append(buttons);cancel.focus();
	}
	onClose():void {this.contentEl.replaceChildren();this.done(this.result);}
}

class ValueDialog extends Modal {
	private result:string|null=null;
	private frame:number|null=null;
	constructor(app:App,private readonly request:TableValueRequest,private readonly done:(value:string|null)=>void){super(app);}
	onOpen():void {
		this.titleEl.textContent=this.request.title;const doc=this.contentEl.ownerDocument;
		const input=doc.createElement('input');input.type='text';input.value=this.request.initial;input.setAttribute('aria-label',this.request.title);input.className='paraflow-table-format-input';this.contentEl.append(input);
		const error=doc.createElement('p');error.className='paraflow-table-dialog-error';error.setAttribute('aria-live','polite');this.contentEl.append(error);
		const normalized=()=>this.request.kind==='size'&&/^\d+(?:\.\d+)?$/u.test(input.value.trim())?`${input.value.trim()}px`:input.value.trim();
		const preview=()=>{try{this.request.preview(normalized());error.textContent='';}catch(reason){this.request.clearPreview();error.textContent=reason instanceof Error?reason.message:String(reason);}};
		input.oninput=()=>{if(this.frame!==null)doc.defaultView!.cancelAnimationFrame(this.frame);this.frame=doc.defaultView!.requestAnimationFrame(()=>{this.frame=null;preview();});};
		const choices=doc.createElement('div');choices.className='paraflow-table-format-choices';
		const candidates=this.request.kind==='link'?[]:this.request.kind==='font'?['sans-serif','serif','monospace','Arial','Georgia','Microsoft YaHei','SimSun']:this.request.kind==='size'?['12px','14px','16px','18px','24px','32px']:['#000000','#ffffff','#dc2626','#d97706','#16a34a','#2563eb','#9333ea','transparent'];
		for(const value of candidates){const button=doc.createElement('button');button.textContent=value;button.onmouseenter=()=>{try{this.request.preview(value);}catch(reason){error.textContent=String(reason);}};button.onmouseleave=()=>this.request.clearPreview();button.onclick=()=>{input.value=value;preview();};choices.append(button);}
		this.contentEl.append(choices);
		const buttons=doc.createElement('div');buttons.className='paraflow-table-dialog-buttons';const cancel=doc.createElement('button');cancel.textContent='取消';cancel.onclick=()=>this.close();
		const confirm=doc.createElement('button');confirm.textContent='确定';confirm.className='mod-cta';confirm.onclick=()=>{preview();if(error.textContent)return;this.result=normalized();this.close();};buttons.append(cancel,confirm);this.contentEl.append(buttons);input.focus();input.select();
	}
	onClose():void {if(this.frame!==null)this.contentEl.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);this.request.clearPreview();this.contentEl.replaceChildren();this.done(this.result);}
}

class DimensionsDialog extends Modal {
	private result:{rows:number;columns:number}|null=null;
	constructor(app:App,private readonly done:(value:{rows:number;columns:number}|null)=>void){super(app);}
	onOpen():void {
		this.titleEl.textContent='新建表格';const doc=this.contentEl.ownerDocument;const inputs:HTMLInputElement[]=[];
		for(const name of ['行数','列数']){const label=doc.createElement('label');label.textContent=name;const input=doc.createElement('input');input.type='number';input.min='1';input.step='1';input.value='3';input.setAttribute('aria-label',name);label.append(input);this.contentEl.append(label);inputs.push(input);}
		const error=doc.createElement('p');error.className='paraflow-table-dialog-error';this.contentEl.append(error);
		const buttons=doc.createElement('div');buttons.className='paraflow-table-dialog-buttons';const cancel=doc.createElement('button');cancel.textContent='取消';cancel.onclick=()=>this.close();
		const confirm=doc.createElement('button');confirm.textContent='创建';confirm.className='mod-cta';confirm.onclick=()=>{
			const rows=Number(inputs[0]!.value),columns=Number(inputs[1]!.value);
			if(!Number.isSafeInteger(rows)||!Number.isSafeInteger(columns)||rows<1||columns<1||rows*columns>10000){error.textContent='请输入正整数；单次创建不超过 10000 个单元格。';return;}
			this.result={rows,columns};this.close();
		};buttons.append(cancel,confirm);this.contentEl.append(buttons);inputs[0]!.focus();
	}
	onClose():void {this.contentEl.replaceChildren();this.done(this.result);}
}

export interface TableEditingHost {
	getBreakEditingEnabled:()=>boolean;
	getAutoWrap:()=>boolean;
	setAutoWrap:(enabled:boolean)=>Promise<void>;
	getHideAddControls?:()=>boolean;
	isActive:(view:EditorView)=>boolean;
	getView:()=>EditorView|null;
	getMergeWarning:()=>boolean;
	setMergeWarning:(enabled:boolean)=>Promise<void>;
}

/** One host menu shell for both native Markdown and ParaFlow HTML editors. */
export function createTableEditingIntegration(app:App,host:TableEditingHost) {
	const options:TableEditingOptions={...host,showMenu:createNativeTableMenuPresenter(()=>new Menu() as unknown as HostTableMenu),renderMenuIcon:setIcon,notify:message=>{new FailureDialog(app,tableErrorMessage(message)).open();},
		isActiveView:view=>host.getView()===view,
		isSourceMode:view=>{const markdown=app.workspace.getActiveViewOfType(MarkdownView);return host.getView()===view&&markdown?.getMode()==='source'&&markdown.getState().source===true;},
		openWikiLink:(view,target,newLeaf)=>app.workspace.openLinkText(target,view.state.field(editorInfoField).file?.path??'',newLeaf),
		registerKeyScope:(view,handle)=>requireApiVersion('1.5.7')?bindTableCellScope(view,()=>{
			let owner:View|null=null;
			app.workspace.iterateAllLeaves(leaf=>{if(leaf.view.getViewType()==='markdown'&&leaf.view.containerEl.contains(view.dom))owner=leaf.view;});
			if(!owner)return null;const target=owner as View;
			return {owner:target,scope:new Scope(target.scope??app.scope)};
		},handle):()=>{},
		confirmMerge:()=>new Promise(resolve=>new MergeDialog(app,resolve).open()),
		confirmConversion:losses=>new Promise(resolve=>new ConversionDialog(app,losses,resolve).open()),
		requestValue:request=>new Promise(resolve=>new ValueDialog(app,request,resolve).open()),
		requestDimensions:()=>new Promise(resolve=>new DimensionsDialog(app,resolve).open()),
		writeClipboard:text=>navigator.clipboard.writeText(text),
		writeClipboardContent:content=>navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([content.text],{type:'text/plain'}),'text/html':new Blob([content.html??content.text],{type:'text/html'})})]),
		readClipboard:async()=>{const view=host.getView();if(!view)throw new Error('没有当前编辑器。');const data=await readClipboardData(view);return {text:data.getData('text/plain'),html:data.getData('text/html')||undefined};},
		getNativeCellEditor:(view,cell)=>{
			const owner=view.state.field(editorInfoField,false)?.editor as unknown as NativeEditorOwner|undefined;
			const component=owner?.editorComponent,active=component?.tableCell;
			if(owner?.cm!==view||component?.cm!==view||!active||active.cell.el!==cell||active.editor.cm!==active.cm)return null;
			for(const method of ['triggerWikilink','insertMarkdownLink','toggleMarkdownFormatting','toggleHighlight','toggleComment','clearMarkdownFormatting'] as const)if(typeof active.editor[method]!=='function')return null;
			return active.editor;
		},
		nativeClipboard:(view,action)=>{
			const contents=(view.dom.ownerDocument.defaultView as ClipboardHostWindow).electron?.remote.getCurrentWebContents();
			if(!contents||typeof contents[action]!=='function')throw new Error('宿主剪贴板命令不可用，请使用键盘快捷键。');
			contents[action]();
		},
	};
	const leafChange=app.workspace.on('active-leaf-change',()=>{refreshTableToolbarOwnership();refreshTableAddControlOwnership();});
	const report=(error:unknown)=>options.notify(error instanceof Error?error.message:String(error));
	const commands:Command[]=[
		{id:'table-actions',name:'表格操作与格式',checkCallback:checking=>{const view=host.getView();if(!view||!canEditCurrentTable(view,options))return false;if(!checking){try{showCurrentTableMenu(view,options);}catch(error){report(error);}}return true;}},
		{id:'insert-html-table',name:'新建可合并表格',checkCallback:checking=>{const view=host.getView();if(!view||!options.isActive(view))return false;if(!checking)void insertNewTable(view,options).catch(report);return true;}},
	];
	const cellSources=createNativeCellSourceEditing(view=>host.isActive(view)&&host.getBreakEditingEnabled(),view=>{
		const owner=view.state.field(editorInfoField,false)?.editor as unknown as NativeEditorOwner|undefined;
		const component=owner?.editorComponent,active=component?.tableCell;
		return owner?.cm===view&&component?.cm===view&&active&&active.editor.cm===active.cm&&
			typeof active.cell.text==='string'&&typeof active.cell.getAbsoluteOffsets==='function'?active:null;
	});
	return {options,extension:[createTableEditingExtension(options),cellSources],commands,destroy:()=>{app.workspace.offref(leafChange);}};
}
