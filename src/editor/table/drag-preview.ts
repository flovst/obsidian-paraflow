import { createDetachedEl } from '../../dom';
import type {TableAxis} from './model';

export interface TableDragPoint {readonly x:number;readonly y:number;}

const contentStyles=['color','background-color','font-family','font-size','font-weight','font-style','line-height','text-align','text-decoration','vertical-align','white-space','overflow-wrap','word-break','direction','margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left','border-top','border-right','border-bottom','border-left'] as const;
const chrome='.table-col-drag-handle,.table-row-drag-handle,.table-row-btn,.table-col-btn,.table-drag-target,.cm-gutters,.cm-cursorLayer,.cm-selectionLayer,.cm-announced,.paraflow-html-table-rail,.markdown-embed-link,.edit-block-button';
let nextPreviewId=0;

function copyAppearance(source:HTMLElement,clone:HTMLElement):void {
	const style=source.ownerDocument.defaultView!.getComputedStyle(source);
	for(const property of contentStyles)clone.style.setProperty(property,style.getPropertyValue(property));
}

function snapshotCell(source:HTMLTableCellElement,origin:{left:number;top:number}):HTMLTableCellElement {
	const clone=source.cloneNode(true) as HTMLTableCellElement;copyAppearance(source,clone);
	const originals=Array.from(source.querySelectorAll<HTMLElement>('*'));const copies=Array.from(clone.querySelectorAll<HTMLElement>('*'));
	for(let index=0;index<originals.length;index++){
		const original=originals[index]!,copy=copies[index]!,style=source.ownerDocument.defaultView!.getComputedStyle(original);
		if(original.hidden||style.display==='none'||style.visibility==='hidden')copy.remove();else copyAppearance(original,copy);
	}
	for(const node of clone.querySelectorAll(chrome))node.remove();
	for(const element of [clone,...Array.from(clone.querySelectorAll<HTMLElement>('*'))]){
		element.classList.remove('is-selected','mod-dragging','has-focus');
		for(const name of element.getAttributeNames())if(name==='contenteditable'||name==='tabindex'||name==='autofocus'||name==='aria-label'||name==='aria-labelledby'||name.startsWith('on'))element.removeAttribute(name);
	}
	for(const editor of clone.querySelectorAll('.cm-editor')){const content=editor.querySelector('.cm-content');if(content)editor.replaceWith(content);}
	const box=source.getBoundingClientRect();clone.style.left=`${box.left-origin.left}px`;clone.style.top=`${box.top-origin.top}px`;clone.style.width=`${box.width}px`;clone.style.height=`${box.height}px`;
	return clone;
}

function snapshotTable(table:HTMLTableElement,selectedCells:readonly HTMLElement[],box:{left:number;top:number;width:number;height:number}):HTMLTableElement {
	const doc=table.ownerDocument;const snapshot=createDetachedEl(doc, 'table');snapshot.className='paraflow-table-drag-preview-table';copyAppearance(table,snapshot);
	snapshot.style.width=`${box.width}px`;snapshot.style.height=`${box.height}px`;
	const rows=new Map<number,HTMLTableCellElement[]>();
	for(const cell of selectedCells as readonly HTMLTableCellElement[]){const index=(cell.parentElement as HTMLTableRowElement).rowIndex;const cells=rows.get(index)??[];cells.push(cell);rows.set(index,cells);}
	const body=createDetachedEl(doc, 'tbody');snapshot.append(body);
	for(const [,cells] of Array.from(rows).sort(([first],[second])=>first-second)){
		const row=createDetachedEl(doc, 'tr');body.append(row);
		for(const cell of cells.sort((a,b)=>a.cellIndex-b.cellIndex))row.append(snapshotCell(cell,box));
	}
	const ids=new Map<string,string>(),prefix=`pf-table-drag-${++nextPreviewId}-`;
	for(const element of snapshot.querySelectorAll<HTMLElement>('[id]')){const id=element.id,newId=prefix+id;ids.set(id,newId);element.id=newId;}
	for(const element of snapshot.querySelectorAll('*'))for(const attribute of element.attributes){
		const local=attribute.value.startsWith('#')?ids.get(attribute.value.slice(1)):undefined;
		if(local)element.setAttribute(attribute.name,`#${local}`);
		else if(attribute.value.includes('url('))element.setAttribute(attribute.name,attribute.value.replace(/url\((['"]?)#([^)'"\s]+)\1\)/gu,(value:string,quote:string,id:string)=>ids.has(id)?`url(${quote}#${ids.get(id)!}${quote})`:value));
	}
	return snapshot;
}

/** Content-only visual companion; the caller retains the drag operation. */
export class TableDragPreview {
	readonly dom:HTMLElement;
	readonly ghost:HTMLElement;
	private readonly startBox:DOMRect;
	private readonly contentBox:{left:number;top:number;width:number;height:number};
	private readonly clips:Array<{element:HTMLElement;x:boolean;y:boolean}>=[];
	private point:TableDragPoint;
	private frame:number|null=null;
	private destroyed=false;
	constructor(private readonly table:HTMLTableElement,selectedCells:readonly HTMLElement[],private readonly axis:TableAxis,private readonly start:TableDragPoint){
		const doc=table.ownerDocument;this.startBox=table.getBoundingClientRect();this.point=start;
		for(let element=table.parentElement;element;element=element.parentElement){
			const style=doc.defaultView!.getComputedStyle(element),scroller=element.classList.contains('cm-scroller');
			const x=scroller||/(auto|scroll|hidden|clip)/u.test(style.overflowX||style.overflow),y=scroller||/(auto|scroll|hidden|clip)/u.test(style.overflowY||style.overflow);
			if(x||y)this.clips.push({element,x,y});
		}
		const boxes=selectedCells.map(cell=>cell.getBoundingClientRect());const left=Math.min(...boxes.map(box=>box.left)),top=Math.min(...boxes.map(box=>box.top));
		this.contentBox={left,top,width:Math.max(...boxes.map(box=>box.right))-left,height:Math.max(...boxes.map(box=>box.bottom))-top};
		this.dom=createDetachedEl(doc, 'div');this.dom.className='paraflow-table-drag-preview-layer';this.dom.setAttribute('aria-hidden','true');this.dom.setAttribute('inert','');
		this.ghost=createDetachedEl(doc, 'div');this.ghost.className=`paraflow-table-drag-preview mod-${axis==='column'?'col':'row'}`;this.ghost.style.width=`${this.contentBox.width}px`;this.ghost.style.height=`${this.contentBox.height}px`;
		this.ghost.append(snapshotTable(table,selectedCells,this.contentBox));this.dom.append(this.ghost);doc.body.append(this.dom);this.position();
		doc.addEventListener('scroll',this.schedule,true);doc.defaultView!.addEventListener('resize',this.schedule);
	}
	update(point:TableDragPoint):void {this.point=point;this.schedule();}
	private schedule=():void=>{
		if(this.destroyed||this.frame!==null)return;
		this.frame=this.table.ownerDocument.defaultView!.requestAnimationFrame(()=>{this.frame=null;this.position();});
	};
	get clipOrigin():{left:number;top:number} {
		const {left,top}=this.clipBounds(this.table.getBoundingClientRect());return {left,top};
	}
	private clipBounds(table:DOMRect):{left:number;top:number;right:number;bottom:number} {
		const win=this.table.ownerDocument.defaultView!;
		let left=Math.max(0,table.left),top=Math.max(0,table.top),right=Math.min(win.innerWidth,table.right),bottom=Math.min(win.innerHeight,table.bottom);
		for(const clip of this.clips){
			const box=clip.element.getBoundingClientRect();
			if(clip.x){left=Math.max(left,box.left);right=Math.min(right,box.right);}
			if(clip.y){top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom);}
		}
		return {left,top,right,bottom};
	}
	private position():void {
		if(!this.table.isConnected){this.destroy();return;}
		const table=this.table.getBoundingClientRect(),{left,top,right,bottom}=this.clipBounds(table);
		this.dom.hidden=right<=left||bottom<=top;
		for(const [property,value] of [['left',left],['top',top],['width',Math.max(0,right-left)],['height',Math.max(0,bottom-top)]] as const){const pixels=`${value}px`;if(this.dom.style.getPropertyValue(property)!==pixels)this.dom.style.setProperty(property,pixels);}
		const x=this.contentBox.left+(this.axis==='column'?this.point.x-this.start.x:table.left-this.startBox.left)-left;
		const y=this.contentBox.top+(this.axis==='row'?this.point.y-this.start.y:table.top-this.startBox.top)-top;
		const transform=`translate3d(${x}px, ${y}px, 0)`;if(this.ghost.style.transform!==transform)this.ghost.style.transform=transform;
	}
	destroy():void {
		if(this.destroyed)return;this.destroyed=true;
		const doc=this.table.ownerDocument;if(this.frame!==null)doc.defaultView!.cancelAnimationFrame(this.frame);this.frame=null;
		doc.removeEventListener('scroll',this.schedule,true);doc.defaultView!.removeEventListener('resize',this.schedule);this.dom.remove();
	}
}
