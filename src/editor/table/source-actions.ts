import type {EditorView} from '@codemirror/view';
import {assertTableSourceCurrent,type TableSource} from './edit-session';
import type {TableEditingOptions} from './editing-types';
import type {TableMenuItem} from './popup';
import type {TableActionTarget} from './action-target';
import {formatMarkdownTable} from './toolbar-source';
import {formatHtmlTable} from './html-source-format';
import {NativeTableTarget} from './native-target';

/** Source operations do not require admission to the richer HTML cell model. */
export function tableSourceActions(view:EditorView,source:TableSource,options:TableEditingOptions,cell:HTMLElement|null,target?:TableActionTarget,checkLifecycle:()=>void=()=>{}):TableMenuItem[]{
	cell??=target?.cellElement(target.focusBookmark.cell)??null;
	const widget=source.kind==='markdown'&&!source.container?(cell?.closest<HTMLElement>('.cm-table-widget')??Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-table-widget')).find(widget=>view.posAtDOM(widget)===source.from)):null;
	const nativeTable=widget?.querySelector('table');
	// The host excludes GFM plain-text continuation rows from its native widget.
	const to=nativeTable?Math.min(source.to,view.state.doc.line(view.state.doc.lineAt(source.from).number+nativeTable.rows.length).to):source.to;
	const text=to===source.to?source.source:view.state.doc.sliceString(source.from,to);
	const focus=target?.focusBookmark??(cell?NativeTableTarget.captureSourceFocus(cell):undefined);
	const formatReason=view.state.readOnly?'文档只读':undefined;
	const run=(action:()=>void|Promise<void>)=>()=>{
		try{checkLifecycle();if(!options.isActive(view)||options.isActiveView?.(view)===false)throw new Error('表格操作目标已变化，请重新选择。');if(target)target.session.assertCurrent(view.state);else assertTableSourceCurrent(view.state,source);
			void Promise.resolve(action()).catch(error=>options.notify(error instanceof Error?error.message:String(error)));
		}catch(error){options.notify(error instanceof Error?error.message:String(error));}
	};
	return [
		{label:'复制表格',icon:'copy',run:run(()=>options.writeClipboard(view.state.sliceDoc(source.from,to)))},
		{label:'格式化表格源码',icon:'code-xml',disabled:!!formatReason,disabledReason:formatReason,run:run(()=>{
			if(view.state.readOnly)return;
			const next=source.kind==='markdown'?formatMarkdownTable(text):formatHtmlTable(text);
			if(next===text)return;
			if(target)target.replaceSource(next,undefined,focus);
			else NativeTableTarget.replaceMarkdownSource(view,source,cell,next,focus,to);
		})},
	];
}
