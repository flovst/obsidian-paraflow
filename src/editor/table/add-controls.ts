const activeControls=new Set<TableAddControls>();
export function refreshTableAddControlOwnership():void {for(const controls of activeControls)controls.refreshOwnership();}

/** Shared actions stay outside both the content width and its scroll box. */
export class TableAddControls {
	private readonly dom:HTMLElement;
	private readonly resize:ResizeObserver|null;
	private readonly document:Document;
	constructor(private readonly host:HTMLElement,private readonly table:()=>HTMLTableElement,insert:(axis:'row'|'column')=>void,private readonly isActive:()=>boolean=()=>true){
		activeControls.add(this);
		const doc=this.document=host.ownerDocument;this.dom=doc.createElement('div');this.dom.className='paraflow-table-add-controls';this.dom.hidden=true;
		for(const axis of ['row','column'] as const){const button=doc.createElement('button');button.type='button';button.dataset.pfAdd=axis;button.textContent='+';button.setAttribute('aria-label',axis==='row'?'新增行':'新增列');button.onmousedown=event=>event.preventDefault();button.onclick=()=>{insert(axis);this.position();};this.dom.append(button);}
		doc.body.append(this.dom);host.addEventListener('pointerenter',this.show);host.addEventListener('pointerleave',this.leave);this.dom.addEventListener('pointerleave',this.leave);
		doc.addEventListener('scroll',this.position,true);doc.defaultView!.addEventListener('resize',this.position);
		this.resize=doc.defaultView!.ResizeObserver?new doc.defaultView!.ResizeObserver(this.position):null;this.resize?.observe(host);
	}
	refreshOwnership():void {if(!this.isActive())this.dom.hidden=true;}
	private show=()=>{this.dom.hidden=!this.isActive();this.position();};
	private leave=(event:PointerEvent)=>{const next=event.relatedTarget as Node|null;if(!next||(!this.host.contains(next)&&!this.dom.contains(next)))this.dom.hidden=true;};
	private position=()=>{
		this.refreshOwnership();if(this.dom.hidden)return;const box=this.table().getBoundingClientRect();const clip=this.host.getBoundingClientRect();
		this.dom.style.fontSize=this.host.ownerDocument.defaultView!.getComputedStyle(this.host).fontSize;
		const row=this.dom.querySelector<HTMLElement>('[data-pf-add="row"]')!,column=this.dom.querySelector<HTMLElement>('[data-pf-add="column"]')!;
		row.style.left=`${Math.max(box.left,clip.left)}px`;row.style.top=`${box.bottom}px`;row.style.width=`${Math.max(0,Math.min(box.right,clip.right)-Math.max(box.left,clip.left))}px`;
		column.style.left=`${Math.min(box.right,clip.right)}px`;column.style.top=`${box.top}px`;column.style.height=`${box.height}px`;
	};
	destroy():void {activeControls.delete(this);this.resize?.disconnect();this.host.removeEventListener('pointerenter',this.show);this.host.removeEventListener('pointerleave',this.leave);const doc=this.document;doc.removeEventListener('scroll',this.position,true);doc.defaultView!.removeEventListener('resize',this.position);this.dom.remove();}
}
