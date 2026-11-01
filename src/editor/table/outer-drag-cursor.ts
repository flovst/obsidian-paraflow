const activeCursors=new WeakMap<Document,TableOuterDragCursor>();
export type TablePointerHit=Pick<MouseEvent,'target'|'clientX'|'clientY'|'defaultPrevented'>;

/** Outside the clipped table, only the currently hit element borrows the drag cursor. */
export class TableOuterDragCursor {
	private restore:(()=>void)|null=null;
	private target:HTMLElement|null=null;
	private axis:'row'|'column'|null=null;
	private event:TablePointerHit|null=null;
	constructor(private readonly doc:Document,private readonly resolve:(event:TablePointerHit)=>'row'|'column'|null){
		doc.addEventListener('pointerout',this.leave,true);doc.addEventListener('pointerover',this.move,true);
		doc.addEventListener('pointermove',this.move,true);doc.addEventListener('pointerdown',this.clear,true);doc.addEventListener('scroll',this.clear,true);doc.defaultView!.addEventListener('blur',this.clear);doc.defaultView!.addEventListener('resize',this.clear);
	}
	private leave=(event:PointerEvent):void=>{
		if(event.buttons||!event.relatedTarget){this.clear();return;}
		// Transfer before the browser resolves the incoming element's text cursor.
		this.apply({target:event.relatedTarget,clientX:event.clientX,clientY:event.clientY,defaultPrevented:event.defaultPrevented});
	};
	private move=(event:PointerEvent):void=>{
		if(event.buttons){this.clear();return;}
		this.apply(event);
	};
	private apply(event:TablePointerHit):void {
		const element=event.target as HTMLElement|null;
		if(!element||!element.isConnected||element.nodeType!==1||element.namespaceURI!=='http://www.w3.org/1999/xhtml'){this.clear();return;}
		const axis=this.resolve(event);if(!axis){this.clear();return;}
		this.event=event;
		if(this.target===element&&this.axis===axis)return;
		this.clear();this.event=event;this.target=element;this.axis=axis;
		activeCursors.get(this.doc)?.clear();activeCursors.set(this.doc,this);
		const previous=element.style.getPropertyValue('cursor'),priority=element.style.getPropertyPriority('cursor');
		element.style.setProperty('cursor',axis==='row'?'ns-resize':'ew-resize');
		this.restore=()=>{if(previous)element.style.setProperty('cursor',previous,priority);else element.style.removeProperty('cursor');};
	}
	refresh():void {
		if(!this.event)return;
		const previous=this.event;
		const target=this.doc.elementFromPoint(previous.clientX,previous.clientY);
		if(!target){this.clear();return;}
		this.apply({target,clientX:previous.clientX,clientY:previous.clientY,defaultPrevented:false});
	}
	clear=():void=>{this.restore?.();this.restore=null;this.target=null;this.axis=null;this.event=null;if(activeCursors.get(this.doc)===this)activeCursors.delete(this.doc);};
	destroy():void {this.clear();this.doc.removeEventListener('pointerout',this.leave,true);this.doc.removeEventListener('pointerover',this.move,true);this.doc.removeEventListener('pointermove',this.move,true);this.doc.removeEventListener('pointerdown',this.clear,true);this.doc.removeEventListener('scroll',this.clear,true);this.doc.defaultView!.removeEventListener('blur',this.clear);this.doc.defaultView!.removeEventListener('resize',this.clear);}
}
