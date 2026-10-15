import type {EditorView} from '@codemirror/view';
import {TableDragPreview} from './drag-preview';

/** The host keeps all native pipe-table selection, target and reorder ownership. */
export class NativeTableDragPreview {
	private preview:TableDragPreview|null=null;
	private pointerId:number|null=null;
	private input:'pointer'|'mouse'|null=null;
	private table:HTMLTableElement|null=null;
	private observer:MutationObserver|null=null;
	constructor(private readonly view:EditorView,private readonly isActive:()=>boolean){
		const doc=view.dom.ownerDocument;
		doc.addEventListener('pointerdown',this.start,true);doc.addEventListener('mousedown',this.start,true);
		doc.addEventListener('pointermove',this.move,true);doc.addEventListener('mousemove',this.move,true);
		doc.addEventListener('pointerup',this.end,true);doc.addEventListener('mouseup',this.end,true);doc.addEventListener('pointercancel',this.end,true);
		doc.addEventListener('keydown',this.key,true);doc.addEventListener('contextmenu',this.cancel,true);doc.addEventListener('dragstart',this.cancel,true);doc.addEventListener('drop',this.cancel,true);doc.defaultView!.addEventListener('blur',this.cancel);
	}
	private start=(event:MouseEvent|PointerEvent):void=>{
		this.refreshOwnership();
		if(this.preview||!this.isActive()||event.button!==0||('isPrimary' in event&&!event.isPrimary))return;
		const target=event.target as HTMLElement;const handle=target.closest?.<HTMLElement>('.table-col-drag-handle,.table-row-drag-handle');if(!handle||!this.view.dom.contains(handle))return;
		const widget=handle.closest('.cm-table-widget'),cell=handle.closest<HTMLTableCellElement>('td,th'),table=cell?.closest<HTMLTableElement>('table.table-editor');if(!widget||!cell||!table)return;
		const axis=handle.classList.contains('table-col-drag-handle')?'column':'row';const cells=axis==='column'?Array.from(table.rows,row=>row.cells[cell.cellIndex]!).filter(Boolean):Array.from((cell.parentElement as HTMLTableRowElement).cells);
		this.input=event.type==='pointerdown'?'pointer':'mouse';this.pointerId='pointerId' in event?event.pointerId:null;
		this.table=table;this.preview=new TableDragPreview(table,cells,axis,{x:event.clientX,y:event.clientY});
		this.observer=new MutationObserver(()=>this.refreshOwnership());this.observer.observe(this.view.dom,{childList:true,subtree:true});
	};
	private matches(event:MouseEvent|PointerEvent):boolean {return this.input===(event.type.startsWith('pointer')?'pointer':'mouse')&&(!('pointerId' in event)||event.pointerId===this.pointerId);}
	private move=(event:MouseEvent|PointerEvent):void=>{this.refreshOwnership();if(this.preview&&this.matches(event))this.preview.update({x:event.clientX,y:event.clientY});};
	private end=(event:MouseEvent|PointerEvent):void=>{if(this.preview&&this.matches(event))this.cancel();};
	private key=(event:KeyboardEvent):void=>{if(event.key==='Escape')this.cancel();};
	private cancel=():void=>{this.observer?.disconnect();this.observer=null;this.preview?.destroy();this.preview=null;this.table=null;this.input=null;this.pointerId=null;};
	refreshOwnership():void {if(!this.isActive()||this.table&&(!this.view.dom.contains(this.table)||!this.preview?.dom.isConnected))this.cancel();}
	destroy():void {
		this.cancel();const doc=this.view.dom.ownerDocument;
		doc.removeEventListener('pointerdown',this.start,true);doc.removeEventListener('mousedown',this.start,true);
		doc.removeEventListener('pointermove',this.move,true);doc.removeEventListener('mousemove',this.move,true);
		doc.removeEventListener('pointerup',this.end,true);doc.removeEventListener('mouseup',this.end,true);doc.removeEventListener('pointercancel',this.end,true);
		doc.removeEventListener('keydown',this.key,true);doc.removeEventListener('contextmenu',this.cancel,true);doc.removeEventListener('dragstart',this.cancel,true);doc.removeEventListener('drop',this.cancel,true);doc.defaultView!.removeEventListener('blur',this.cancel);
	}
}
