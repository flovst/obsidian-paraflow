/** The current hit element owns the drag cursor; content readers release it first. */
export class TableTrackDragCursor {
	private target:EventTarget|null=null;
	private restore:(()=>void)|null=null;
	constructor(private readonly root:HTMLElement,private readonly axis:'row'|'column'){
		const doc=root.ownerDocument;doc.addEventListener('pointerover',this.over,true);
		for(const name of ['beforeinput','compositionstart','copy','cut','paste'])doc.addEventListener(name,this.clear,true);
	}
	private over=(event:PointerEvent):void=>{this.move(event.target);};
	move(target:EventTarget|null):void {
		this.clear();
		if(!(target instanceof this.root.ownerDocument.defaultView!.Element)||!this.root.contains(target)||!('style' in target))return;
		const element=target as HTMLElement;
		// Author inline important already outranks the stylesheet drag cursor.
		if(element.style.getPropertyPriority('cursor'))return;
		const original=element.getAttribute('style'),value=element.style.getPropertyValue('cursor');
		const cursor=this.axis==='row'?'row-resize':'col-resize';element.style.setProperty('cursor',cursor);
		const applied=element.getAttribute('style');this.target=element;
		this.restore=()=>{
			if(element.style.getPropertyValue('cursor')!==cursor||element.style.getPropertyPriority('cursor'))return;
			if(element.getAttribute('style')===applied){if(original===null)element.removeAttribute('style');else element.setAttribute('style',original);}
			else if(value)element.style.setProperty('cursor',value);else element.style.removeProperty('cursor');
		};
	}
	read<T>(read:()=>T):T {const target=this.target;this.clear();try{return read();}finally{this.move(target);}}
	clear=():void=>{this.restore?.();this.restore=null;this.target=null;};
	destroy():void {this.clear();const doc=this.root.ownerDocument;doc.removeEventListener('pointerover',this.over,true);for(const name of ['beforeinput','compositionstart','copy','cut','paste'])doc.removeEventListener(name,this.clear,true);}
}
