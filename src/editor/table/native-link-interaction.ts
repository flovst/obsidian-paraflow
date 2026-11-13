import type {EditorView} from '@codemirror/view';
import {linkOpenIntent} from '../../links/intent';
import type {TableEditingOptions} from './editing-types';
import {openTableLink,tableLinkTarget} from './link-actions';
import {findEditableTableSources} from './edit-session';
import {markdownCellContents,markdownCellSourceEnd} from './toolbar-source';
import {mapRenderedTextSelection} from './markdown-selection';
import {bookmarkRange} from './action-target';

interface LinkGesture {cell:HTMLTableCellElement;content:HTMLElement;target:string;x:number;y:number;cancelled:boolean;}

/** Native table widgets ignore CM handlers and delegate anchor clicks before their cell-focus callback. */
export class NativeTableLinkInteraction {
	private gesture:LinkGesture|null=null;
	constructor(private readonly view:EditorView,private readonly options:TableEditingOptions){
		view.dom.addEventListener('mousedown',this.down,true);view.dom.addEventListener('click',this.click,true);
		const doc=view.dom.ownerDocument;doc.addEventListener('mousemove',this.move,true);doc.addEventListener('pointercancel',this.cancel,true);doc.addEventListener('dragstart',this.cancel,true);doc.defaultView!.addEventListener('blur',this.cancel);
	}
	owns(target:Element):boolean {const content=target.closest('.table-cell-wrapper');return this.options.isActive(this.view)&&this.options.isActiveView?.(this.view)!==false&&this.options.editLinksOnPlainClick?.()!==false&&this.view.dom.contains(target)&&!!target.closest('.cm-table-widget td,.cm-table-widget th')&&tableLinkTarget(target)!==null&&!!content&&!content.querySelector('.cm-content');}
	private down=(event:MouseEvent):void=>{
		this.gesture=null;const target=event.target as Element;
		if(!this.owns(target)||event.button!==0||event.altKey&&!event.ctrlKey&&!event.metaKey)return;
		const destination=tableLinkTarget(target);if(destination===null)return;
		const cell=target.closest<HTMLTableCellElement>('td,th')!,content=target.closest<HTMLElement>('.table-cell-wrapper')!;
		this.gesture={cell,content,target:destination,x:event.clientX,y:event.clientY,cancelled:false};
	};
	private move=(event:MouseEvent):void=>{const gesture=this.gesture;if(gesture&&Math.max(Math.abs(event.clientX-gesture.x),Math.abs(event.clientY-gesture.y))>4)gesture.cancelled=true;};
	private cancel=():void=>{if(this.gesture)this.gesture.cancelled=true;};
	private sourceSelection(gesture:LinkGesture,event:MouseEvent):{anchor:number;head:number}|null {
		const {cell,content}=gesture,selection=cell.ownerDocument.getSelection()!;
		let from:number,to:number,backward=false;
		if(selection.rangeCount&&!selection.isCollapsed&&content.contains(selection.anchorNode)&&content.contains(selection.focusNode)){
			const range=selection.getRangeAt(0),offsets=bookmarkRange(content,range);from=offsets.from;to=offsets.to;backward=selection.anchorNode===range.endContainer&&selection.anchorOffset===range.endOffset;
		}else{
			if(gesture.cancelled||event.detail>1)return null;
			const caret=cell.ownerDocument.caretPositionFromPoint?.(event.clientX,event.clientY);if(!caret||!content.contains(caret.offsetNode))return null;
			const range=cell.ownerDocument.createRange();range.selectNodeContents(content);range.setEnd(caret.offsetNode,caret.offset);from=to=range.toString().length;
		}
		const widget=cell.closest<HTMLElement>('.cm-table-widget')!,position=this.view.posAtDOM(widget),table=findEditableTableSources(this.view.state).find(table=>table.kind==='markdown'&&!table.container&&table.from<=position&&position<=table.to)!;
		const row=(cell.parentElement as HTMLTableRowElement).rowIndex,column=cell.cellIndex,lexical=markdownCellContents(table.source)[row]![column]!.trim(),start=markdownCellSourceEnd(table.source,row,column)-lexical.length;
		const mapped=mapRenderedTextSelection(lexical,from,to,content.textContent??'');if(!mapped)throw new Error('链接文字无法映射到原始表格源码。');
		return {anchor:table.from+start+(backward?mapped.to:mapped.from),head:table.from+start+(backward?mapped.from:mapped.to)};
	}
	private click=(event:MouseEvent):void=>{
		const gesture=this.gesture;this.gesture=null;if(!gesture||!gesture.content.contains(event.target as Node)||!this.owns(event.target as Element))return;
		event.preventDefault();event.stopImmediatePropagation();
		try{
			if(event.ctrlKey||event.metaKey){if(!gesture.cancelled&&event.detail<=1)openTableLink(this.view,gesture.target,linkOpenIntent(event),this.options);}
			else if(gesture.cell.closest('table')!.querySelectorAll('.is-selected').length<=1){
				const selection=this.sourceSelection(gesture,event);if(selection){this.view.focus();this.view.dispatch({selection,userEvent:'select.pointer'});}
			}
		}catch(error){this.options.notify(error instanceof Error?error.message:String(error));}
		finally{
			// Consume the host's pending window click without its setCellFocus/normalization action.
			const complete=new this.view.dom.ownerDocument.defaultView!.MouseEvent('click',{bubbles:true,cancelable:true});complete.preventDefault();gesture.content.dispatchEvent(complete);
		}
	};
	destroy():void {this.gesture=null;this.view.dom.removeEventListener('mousedown',this.down,true);this.view.dom.removeEventListener('click',this.click,true);const doc=this.view.dom.ownerDocument;doc.removeEventListener('mousemove',this.move,true);doc.removeEventListener('pointercancel',this.cancel,true);doc.removeEventListener('dragstart',this.cancel,true);doc.defaultView!.removeEventListener('blur',this.cancel);}
}
