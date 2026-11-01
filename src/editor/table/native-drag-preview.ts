import {TableTrackDragCursor} from './track-drag-cursor';
import type {EditorView} from '@codemirror/view';
import {TableDragPreview} from './drag-preview';
import {NativeTableTarget} from './native-target';
import {moveMarkdownTracks} from './toolbar-source';

/** Own the complete reorder gesture so the host cannot start a second drag. */
export class NativeTableDragPreview {
	private preview:TableDragPreview|null=null;
	private cursor:TableTrackDragCursor|null=null;
	private pointerId:number|null=null;
	private input:'pointer'|'mouse'|null=null;
	private table:HTMLTableElement|null=null;
	private observer:MutationObserver|null=null;
	private reorder:{target:NativeTableTarget;axis:'row'|'column';index:number;last:number;destination:number}|null=null;
	constructor(private readonly view:EditorView,private readonly isActive:()=>boolean){
		const doc=view.dom.ownerDocument;
		doc.addEventListener('pointerdown',this.start,true);doc.addEventListener('mousedown',this.start,true);
		doc.addEventListener('pointermove',this.move,true);doc.addEventListener('mousemove',this.move,true);
		doc.addEventListener('pointerup',this.end,true);doc.addEventListener('mouseup',this.end,true);doc.addEventListener('pointercancel',this.end,true);
		doc.addEventListener('keydown',this.key,true);doc.addEventListener('contextmenu',this.cancel,true);doc.addEventListener('dragstart',this.cancel,true);doc.addEventListener('drop',this.cancel,true);doc.defaultView!.addEventListener('blur',this.cancel);
	}
	private start=(event:MouseEvent|PointerEvent):void=>{
		this.refreshOwnership();
		if(this.preview){event.preventDefault();event.stopImmediatePropagation();return;}
		if(!this.isActive()||event.button!==0||('isPrimary' in event&&!event.isPrimary))return;
		const target=event.target as HTMLElement;const handle=target.closest?.<HTMLElement>('.table-col-drag-handle,.table-row-drag-handle');if(!handle||!this.view.dom.contains(handle))return;
		const widget=handle.closest('.cm-table-widget'),cell=handle.closest<HTMLTableCellElement>('td,th'),table=cell?.closest<HTMLTableElement>('table.table-editor');if(!widget||!cell||!table)return;
		const axis=handle.classList.contains('table-col-drag-handle')?'column':'row';
		const action=NativeTableTarget.fromView(this.view,cell,false);if(!action)return;
		const index=axis==='column'?action.trackRectangle.left:action.trackRectangle.top,last=axis==='column'?action.trackRectangle.right:action.trackRectangle.bottom;
		const cells=Array.from(table.rows).flatMap((row,rowIndex)=>Array.from(row.cells).filter((_,column)=>{const track=axis==='column'?column:rowIndex;return track>=index&&track<=last;}));
		this.reorder={target:action,axis,index,last,destination:index};event.preventDefault();event.stopImmediatePropagation();
		this.input=event.type==='pointerdown'?'pointer':'mouse';this.pointerId='pointerId' in event?event.pointerId:null;
		this.cursor=new TableTrackDragCursor(this.view.dom,axis);this.cursor.move(event.target);
		this.table=table;this.preview=new TableDragPreview(table,cells,axis,{x:event.clientX,y:event.clientY});
		this.observer=new MutationObserver(()=>this.refreshOwnership());this.observer.observe(this.view.dom,{childList:true,subtree:true});
	};
	private matches(event:MouseEvent|PointerEvent):boolean {return this.input===(event.type.startsWith('pointer')?'pointer':'mouse')&&(!('pointerId' in event)||event.pointerId===this.pointerId);}
	private move=(event:MouseEvent|PointerEvent):void=>{this.refreshOwnership();if(this.preview&&this.matches(event)){
		event.preventDefault();event.stopImmediatePropagation();this.preview.update({x:event.clientX,y:event.clientY});this.cursor!.move(event.target);
		const drag=this.reorder!,tracks=drag.axis==='row'?Array.from(this.table!.rows):Array.from(this.table!.rows[0]!.cells);
		const coordinate=drag.axis==='row'?event.clientY:event.clientX;
		let destination=tracks.length-1;
		for(let index=0;index<tracks.length;index++){const box=tracks[index]!.getBoundingClientRect();if(coordinate<(drag.axis==='row'?box.bottom:box.right)){destination=index;break;}}
		drag.destination=Math.min(destination,tracks.length-(drag.last-drag.index+1));
	}};
	private end=(event:MouseEvent|PointerEvent):void=>{if(this.preview&&this.matches(event)){
		const drag=this.reorder!;event.preventDefault();event.stopImmediatePropagation();this.cancel();
		if(event.type!=='pointercancel'&&drag.destination!==drag.index){
			const source=moveMarkdownTracks(drag.target.session.target.source,drag.axis,drag.index,drag.last,drag.destination);
			const before=drag.target.focusBookmark;
			drag.target.replaceSource(source,undefined,{...before,cell:{...before.cell,[drag.axis]:drag.destination},rectangle:undefined});
		}
	}};
	private key=(event:KeyboardEvent):void=>{if(event.key==='Escape')this.cancel();};
	private cancel=():void=>{this.cursor?.destroy();this.cursor=null;this.observer?.disconnect();this.observer=null;this.preview?.destroy();this.preview=null;this.table=null;this.input=null;this.pointerId=null;this.reorder=null;};
	refreshOwnership():void {if(!this.isActive()||this.table&&(!this.view.dom.contains(this.table)||!this.preview?.dom.isConnected))this.cancel();}
	destroy():void {
		this.cancel();const doc=this.view.dom.ownerDocument;
		doc.removeEventListener('pointerdown',this.start,true);doc.removeEventListener('mousedown',this.start,true);
		doc.removeEventListener('pointermove',this.move,true);doc.removeEventListener('mousemove',this.move,true);
		doc.removeEventListener('pointerup',this.end,true);doc.removeEventListener('mouseup',this.end,true);doc.removeEventListener('pointercancel',this.end,true);
		doc.removeEventListener('keydown',this.key,true);doc.removeEventListener('contextmenu',this.cancel,true);doc.removeEventListener('dragstart',this.cancel,true);doc.removeEventListener('drop',this.cancel,true);doc.defaultView!.removeEventListener('blur',this.cancel);
	}
}
