import {EditorView} from '@codemirror/view';
import {activateNativeCell} from './focus-handoff';
import type {TableEditingOptions} from './editing-types';
import type {TableMenuItem} from './popup';
import {tableTextMenu,type TableTextCommand} from './text-menu-model';

/** Observed host cell-editor methods; never construct or replace a host editor. */
export interface NativeCellEditor {
	readonly cm:EditorView;
	triggerWikilink(embed:boolean):void;
	insertMarkdownLink():void;
	toggleMarkdownFormatting(format:'bold'|'italic'|'strikethrough'|'code'|'math'):void;
	toggleHighlight(color:string):void;
	toggleComment():void;
	clearMarkdownFormatting():void;
}
export type NativeClipboardAction='cut'|'copy'|'paste'|'pasteAndMatchStyle';
const menuOwners=new WeakMap<EditorView,symbol>();
export function clearNativeTextMenu(view:EditorView):void {menuOwners.delete(view);}

/** This path also serves native cells whose syntax cannot enter the HTML table model. */
export function nativeTableTextActions(view:EditorView,cell:HTMLElement,options:TableEditingOptions,checkLifecycle:()=>void=()=>{}):TableMenuItem[] {
	const owner=Symbol();menuOwners.set(view,owner);
	const doc=view.state.doc,content=cell.querySelector<HTMLElement>('.cm-content'),opening=content?EditorView.findFromDOM(content):null;
	const text=opening&&opening!==view?opening.state.doc.toString():null;
	const selection=opening&&opening!==view?opening.state.selection.main:null;
	const bookmark={from:selection?.from??0,to:selection?.to??0},hasSelection=bookmark.from!==bookmark.to;
	const check=()=>{checkLifecycle();if(menuOwners.get(view)!==owner||!options.isActive(view)||options.isActiveView?.(view)===false||view.state.doc!==doc||!cell.isConnected||!view.dom.contains(cell))throw new Error('表格编辑目标已变化，请重新选择。');};
	const restore=():NativeCellEditor=>{
		check();if(!cell.querySelector('.cm-content'))activateNativeCell(cell as HTMLTableCellElement);
		const element=cell.querySelector<HTMLElement>('.cm-content'),nested=element?EditorView.findFromDOM(element):null;
		const editor=options.getNativeCellEditor?.(view,cell);
		if(!nested||nested===view||!editor||editor.cm!==nested||opening&&opening!==view&&opening!==nested||text!==null&&nested.state.doc.toString()!==text)throw new Error('原生单元格编辑器已变化，请重新打开菜单。');
		nested.dispatch({selection:{anchor:bookmark.from,head:bookmark.to}});nested.focus();return editor;
	};
	const run=(command:TableTextCommand)=>()=>{
		try{
			check();if(view.state.readOnly&&command!=='copy'&&command!=='selectAll')return;
			const editor=restore();
			if(command==='wiki')editor.triggerWikilink(false);
			else if(command==='link')editor.insertMarkdownLink();
			else if(command==='comment')editor.toggleComment();
			else if(command==='clear')editor.clearMarkdownFormatting();
			else if(command.startsWith('highlight:'))editor.toggleHighlight(command.slice('highlight:'.length));
			else if(command==='selectAll')editor.cm.dispatch({selection:{anchor:0,head:editor.cm.state.doc.length}});
			else if(command==='cut'||command==='copy'||command==='paste'||command==='pastePlain')options.nativeClipboard!(view,command==='pastePlain'?'pasteAndMatchStyle':command);
			else editor.toggleMarkdownFormatting(command as 'bold'|'italic'|'strikethrough'|'code'|'math');
		}catch(error){options.notify(error instanceof Error?error.message:String(error));}
	};
	return tableTextMenu(command=>{
		const commands:Partial<Record<TableTextCommand,string>>={wiki:'insert-wikilink',link:'insert-link',bold:'toggle-bold',italic:'toggle-italics',strikethrough:'toggle-strikethrough',code:'toggle-code',math:'toggle-inline-math',comment:'toggle-comments',clear:'clear-formatting'};
		const id=command.startsWith('highlight:')?'toggle-highlight'+(command.slice(10)?'-'+command.slice(10):''):commands[command];
		const clipboard=['cut','copy','paste','pastePlain'].includes(command);
		const unavailable=!options.getNativeCellEditor||clipboard&&!options.nativeClipboard;
		const disabled=unavailable||view.state.readOnly&&command!=='copy'&&command!=='selectAll'||['cut','copy','clear'].includes(command)&&!hasSelection;
		return {commandId:id?'editor:'+id:undefined,disabled,disabledReason:unavailable?'宿主原生单元格命令不可用':disabled?view.state.readOnly?'文档只读':'请先选择文字':undefined,run:run(command)};
	});
}
