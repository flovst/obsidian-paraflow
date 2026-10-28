import { createDetachedEl } from '../../dom';
import {admittedFragment} from './admitted-dom';
import {bookmarkRange,rangeFromBookmark,type TableActionTarget} from './action-target';
import type {TableEditingOptions} from './editing-types';
import {formatTextRange} from './formatting';
import {htmlToGrid} from './html-serialization';
import type {TableMenuItem} from './popup';
import {nativeTableTextActions} from './native-text-actions';
import {tableTextMenu} from './text-menu-model';
import {replaceTextLink} from './text-links';
import type {HighlightColor} from './highlight';
import {encodeWikiSource} from './wiki-links';
import {isInlineFormattingCommand,textFormatTarget} from './text-format-target';

/** Shared cell-text commands use the menu-opening selection, never menu DOM focus. */
export function tableTextActions(target:TableActionTarget,options:TableEditingOptions,check:()=>void):TableMenuItem[] {
	const native=target.session.target.kind==='markdown'&&!target.session.target.container?target.cellElement(target.focusBookmark.cell):null;
	if(native&&options.getNativeCellEditor)return nativeTableTextActions(target.view,native,options,check);
	const doc=target.view.dom.ownerDocument,session=target.session,table=session.table;
	const bookmark=target.textBookmark??target.focusBookmark;
	const cell=table.cells.find(cell=>cell.row===bookmark.cell.row&&cell.column===bookmark.cell.column)!;
	const content=()=>{const element=createDetachedEl(doc, cell.role);element.append(admittedFragment(doc,cell.html));return element;};
	const selected=bookmark.from!==bookmark.to,readOnly=target.view.state.readOnly;
	const run=(action:()=>void|Promise<void>,mutates=true)=>()=>{void Promise.resolve().then(()=>{check();if(mutates&&target.view.state.readOnly)return;return action();}).catch(error=>options.notify(error instanceof Error?error.message:String(error)));};
	const mutate=(edit:(element:HTMLElement,range:Range)=>number|void,keepSelection=false,operationBookmark=bookmark)=>{
		check();if(target.view.state.readOnly)throw new Error('文档只读');const element=content(),range=rangeFromBookmark(element,operationBookmark);const inserted=edit(element,range)??0;
		if(keepSelection&&element.innerHTML===cell.html)return;
		const next={...table,cells:table.cells.map(candidate=>candidate===cell?{...cell,html:element.innerHTML}:candidate)};
		const source=session.target.kind==='markdown'?session.serializeAction(next,false):session.serialize(next,false);
		const from=keepSelection?bookmark.from:inserted+bookmark.from,to=keepSelection?bookmark.to:from;
		target.replaceSource(source,undefined,{cell:bookmark.cell,from,to,text:element.textContent??''});
	};
	const copy=async()=>{const element=content(),range=rangeFromBookmark(element,bookmark),fragment=createDetachedEl(doc, 'span');fragment.append(range.cloneContents());const value={text:range.toString(),html:fragment.innerHTML};if(options.writeClipboardContent)await options.writeClipboardContent(value);else await options.writeClipboard(value.text);};
	const paste=async(plain:boolean)=>{
		const value=await options.readClipboard!();check();
		mutate((element,range)=>{
			let fragment:DocumentFragment;
			if(!plain&&value.html){
				// Clipboard markup crosses an external boundary before it can enter the model.
				const body=new doc.defaultView!.DOMParser().parseFromString(value.html,'text/html').body;
				const comments=doc.createTreeWalker(body,128);const removed:Node[]=[];for(let node=comments.nextNode();node;node=comments.nextNode())removed.push(node);for(const node of removed)node.parentNode!.removeChild(node);
				const admitted=htmlToGrid(`<table><tr><td>${body.innerHTML}</td></tr></table>`).table.cells[0]!.html;fragment=admittedFragment(doc,admitted);
			}else{fragment=doc.createDocumentFragment();value.text.split(/\r\n?|\n/u).forEach((text,index)=>{if(index)fragment.append(createDetachedEl(doc, 'br'));fragment.append(doc.createTextNode(text));});}
			range.deleteContents();const length=fragment.textContent?.length??0;range.insertNode(fragment);return length;
		});
	};
	const link=async(wiki=false)=>{
		const element=content(),range=rangeFromBookmark(element,bookmark),parent=(node:Node)=>node.nodeType===1?node as Element:node.parentElement!;
		const existing=parent(range.startContainer).closest('a'),same=existing&&existing===parent(range.endContainer).closest('a');
		const href=await options.requestValue({title:wiki?same?'编辑内部链接（留空取消链接）':'新增内部链接':same?'编辑外部链接（留空取消链接）':'新增外部链接',initial:same?existing.getAttribute('href')??'':wiki?'':'https://',kind:'link',preview:()=>{},clearPreview:()=>{}});if(href===null)return;check();
		if(wiki&&href.trim())encodeWikiSource({target:href.trim(),alias:null});
		mutate((element,range)=>replaceTextLink(element,range,href.trim(),same?existing.getAttribute('title'):null,wiki),selected);
	};
	return tableTextMenu(command=>{
		if(command==='math'||command==='comment')return {disabled:true,disabledReason:'此操作使用 Markdown 单元格的原生语法编辑器；HTML 单元格暂不支持相同语义。'};
		if(command==='wiki'&&!options.openWikiLink)return {disabled:true,disabledReason:'内部链接导航未连接到宿主。'};
		const mutates=command!=='copy'&&command!=='selectAll';
		const formatBookmark=isInlineFormattingCommand(command)?textFormatTarget(content(),bookmark,command):null;
		const needsSelection=!['wiki','link','paste','pastePlain','selectAll'].includes(command);
		const disabled=mutates&&readOnly||needsSelection&&!selected&&!formatBookmark||(command==='paste'||command==='pastePlain')&&!options.readClipboard;
		const action=()=>{
			if(command==='link')return link();
			if(command==='wiki')return link(true);
			if(command==='copy')return copy();
			if(command==='cut')return copy().then(()=>{check();mutate((_element,range)=>range.deleteContents());});
			if(command==='paste'||command==='pastePlain')return paste(command==='pastePlain');
			if(command==='selectAll')return target.restoreTextSelection({cell:bookmark.cell,from:0,to:content().textContent?.length??0});
			mutate((element,range)=>{
				if(command==='code'){
					const offsets=bookmarkRange(element,range);
					const existing=Array.from(element.querySelectorAll('code')).map(code=>{const run=doc.createRange();run.selectNodeContents(code);return {code,...bookmarkRange(element,run)};}).find(run=>run.from<=offsets.from&&run.to>=offsets.to);
					if(existing){
						const value=existing.code.textContent,before=value.slice(0,offsets.from-existing.from),after=value.slice(offsets.to-existing.from);
						const fragment=doc.createDocumentFragment();if(before){const prefix=createDetachedEl(doc, 'code');prefix.textContent=before;fragment.append(prefix);}fragment.append(doc.createTextNode(range.toString()));if(after){const suffix=createDetachedEl(doc, 'code');suffix.textContent=after;fragment.append(suffix);}existing.code.replaceWith(fragment);
					}else{const code=createDetachedEl(doc, 'code');code.textContent=range.toString();range.deleteContents();range.insertNode(code);}
				}
				else if(command==='clear')formatTextRange(element,range,{type:'reset',includeCode:true});
				else formatTextRange(element,range,{type:'toggle',format:command.startsWith('highlight:')?'highlight':command as 'bold'|'italic'|'strikethrough',color:command.startsWith('highlight:')?command.slice('highlight:'.length) as HighlightColor:undefined});
			},true,formatBookmark??bookmark);
		};
		return {disabled,disabledReason:disabled?readOnly?'文档只读':needsSelection?'请先选择文字':'剪贴板读取不可用':undefined,run:run(action,mutates)};
	});
}
