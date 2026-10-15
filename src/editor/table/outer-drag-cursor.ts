const activeCursors=new WeakMap<Document,TableOuterDragCursor>();

/** Outside the clipped table, only the currently hit element borrows the drag cursor. */
export class TableOuterDragCursor {
	private restore:(()=>void)|null=null;
	constructor(private readonly doc:Document,private readonly resolve:(event:MouseEvent)=>'row'|'column'|null){
		doc.addEventListener('pointermove',this.move,true);doc.addEventListener('pointerdown',this.clear,true);doc.addEventListener('scroll',this.clear,true);doc.defaultView!.addEventListener('blur',this.clear);doc.defaultView!.addEventListener('resize',this.clear);
	}
	private move=(event:PointerEvent):void=>{
		this.clear();if(event.buttons)return;
		const axis=this.resolve(event),element=event.target;if(!axis||!(element instanceof this.doc.defaultView!.HTMLElement))return;
		activeCursors.get(this.doc)?.clear();activeCursors.set(this.doc,this);
		const previous=element.style.getPropertyValue('cursor'),priority=element.style.getPropertyPriority('cursor');
		element.style.setProperty('cursor',axis==='row'?'row-resize':'col-resize');
		this.restore=()=>{if(previous)element.style.setProperty('cursor',previous,priority);else element.style.removeProperty('cursor');};
	};
	clear=():void=>{this.restore?.();this.restore=null;if(activeCursors.get(this.doc)===this)activeCursors.delete(this.doc);};
	destroy():void {this.clear();this.doc.removeEventListener('pointermove',this.move,true);this.doc.removeEventListener('pointerdown',this.clear,true);this.doc.removeEventListener('scroll',this.clear,true);this.doc.defaultView!.removeEventListener('blur',this.clear);this.doc.defaultView!.removeEventListener('resize',this.clear);}
}
