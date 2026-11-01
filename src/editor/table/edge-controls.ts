import {createDetachedEl} from '../../dom';

const owners=new WeakMap<Element,HTMLElement>();
const widgets=new WeakMap<Element,HTMLElement>();
const controls=new Set<TableEdgeControls>();
const dragAxes=new WeakMap<HTMLElement,'row'|'column'>();
type EdgeHost={controls:Set<TableEdgeControls>;resize:ResizeObserver|null;children:MutationObserver|null;frame:number|null};
const hosts=new Map<HTMLElement,EdgeHost>();
function observeHost(host:HTMLElement,root:HTMLElement,control:TableEdgeControls):void {
 let entry=hosts.get(host);
 if(!entry){
  const win=host.ownerDocument.defaultView!,content=root.querySelector('.cm-content');
  entry={controls:new Set(),resize:null,children:null,frame:null};const state=entry;
  const schedule=()=>{if(state.frame!==null)return;state.frame=win.requestAnimationFrame(()=>{state.frame=null;for(const item of state.controls)item.position();});};
  state.resize=win.ResizeObserver?new win.ResizeObserver(schedule):null;
  // A preceding block can move the table while the content's minimum height stays unchanged.
  const observe=()=>{state.resize?.disconnect();state.resize?.observe(host);if(content){state.resize?.observe(content);for(const child of content.children)state.resize?.observe(child);}};
  observe();
  if(content){state.children=new win.MutationObserver(()=>{observe();schedule();});state.children.observe(content,{childList:true});}
  hosts.set(host,state);host.classList.add('paraflow-table-edge-host');
 }
 entry.controls.add(control);
}
function releaseHost(host:HTMLElement,control:TableEdgeControls):void {
 const entry=hosts.get(host)!;entry.controls.delete(control);if(entry.controls.size)return;
 entry.resize?.disconnect();entry.children?.disconnect();if(entry.frame!==null)host.ownerDocument.defaultView!.cancelAnimationFrame(entry.frame);
 hosts.delete(host);host.classList.remove('paraflow-table-edge-host');
}
export function ownsTableEdgeSurface(root:HTMLElement,target:Element,widget?:HTMLElement):boolean {return owners.get(target)===root&&(!widget||widgets.get(target)===widget);}
export function tableEdgeSurfaceAxis(root:HTMLElement,target:Element,widget?:HTMLElement):'row'|'column'|null {return ownsTableEdgeSurface(root,target,widget)?(target as HTMLElement).dataset.pfTableEdge as 'row'|'column':null;}
export function refreshTableEdgeControlOwnership():void {for(const control of controls)control.position();}
export function setTableEdgeDragAxis(root:HTMLElement,axis:'row'|'column'|null):void {if(axis)dragAxes.set(root,axis);else dragAxes.delete(root);for(const control of controls)control.refreshDragAxis();}

/** Permanent hit surfaces resolve the cursor before the browser delivers pointer events. */
export class TableEdgeControls {
 private readonly row:HTMLElement;
 private readonly column:HTMLElement;
 private readonly document:Document;
 private readonly resize:ResizeObserver|null;
 private readonly host:HTMLElement;
 private frame:number|null=null;
 private table:HTMLTableElement|null=null;
 constructor(private readonly root:HTMLElement,private readonly widget:HTMLElement,private readonly isActive:()=>boolean,private readonly owner:HTMLElement=root){
  const doc=this.document=root.ownerDocument;
  this.host=root.querySelector<HTMLElement>('.cm-scroller')??root;observeHost(this.host,root,this);
  this.column=createDetachedEl(doc,'div');this.row=createDetachedEl(doc,'div');
  for(const [element,axis] of [[this.column,'column'],[this.row,'row']] as const){element.className='paraflow-table-edge-control';element.dataset.pfTableEdge=axis;element.setAttribute('aria-hidden','true');element.hidden=true;owners.set(element,owner);widgets.set(element,widget);this.host.append(element);}
  controls.add(this);doc.addEventListener('scroll',this.position,true);doc.addEventListener('contextmenu',this.contextMenu,true);doc.defaultView!.addEventListener('resize',this.position);
  this.resize=doc.defaultView!.ResizeObserver?new doc.defaultView!.ResizeObserver(this.schedulePosition):null;
  this.refreshDragAxis();this.position();
 }
 refreshDragAxis():void {const axis=dragAxes.get(this.owner);for(const element of [this.row,this.column]){if(axis)element.dataset.pfTableDragAxis=axis;else delete element.dataset.pfTableDragAxis;}}
 private schedulePosition=():void=>{if(this.frame!==null)return;this.frame=this.document.defaultView!.requestAnimationFrame(()=>{this.frame=null;this.position();});};
 private contextMenu=(event:MouseEvent):void=>{
  if(event.target!==this.row&&event.target!==this.column)return;
  event.preventDefault();event.stopImmediatePropagation();
  this.row.classList.add('is-passthrough');this.column.classList.add('is-passthrough');
  const target=this.document.elementFromPoint(event.clientX,event.clientY);
  this.row.classList.remove('is-passthrough');this.column.classList.remove('is-passthrough');
  target?.dispatchEvent(new this.document.defaultView!.MouseEvent('contextmenu',{bubbles:true,cancelable:true,view:this.document.defaultView!,button:event.button,buttons:event.buttons,clientX:event.clientX,clientY:event.clientY,screenX:event.screenX,screenY:event.screenY,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey,altKey:event.altKey,metaKey:event.metaKey}));
 };
 position=():void=>{
  const table=this.widget.querySelector('table');
  if(table!==this.table){this.table=table;this.resize?.disconnect();if(table){this.resize?.observe(table);this.resize?.observe(this.widget);}}
  if(!table||!this.widget.isConnected||!this.isActive()){this.row.hidden=this.column.hidden=true;return;}
  const win=this.document.defaultView!,box=table.getBoundingClientRect(),widget=this.widget.getBoundingClientRect();
  const viewport=this.host.getBoundingClientRect(),scale=this.host.offsetWidth?viewport.width/this.host.offsetWidth:1;
  const edge=(Number.parseFloat(win.getComputedStyle(table).fontSize)||16)*.35*(table.offsetWidth?box.width/table.offsetWidth:1);
  let clipLeft=widget.left,clipRight=widget.right,top=viewport.top,bottom=viewport.bottom;
  // Inner horizontal scroll boxes clip tracks, while the outside half of the top strip remains reachable.
  for(let parent=table.parentElement;parent&&parent!==this.root;parent=parent.parentElement){
   const style=win.getComputedStyle(parent),clip=parent.getBoundingClientRect();
   if(/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX)){clipLeft=Math.max(clipLeft,clip.left);clipRight=Math.min(clipRight,clip.right);}
   if(parent.scrollHeight>parent.clientHeight&&/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}
  }
  const place=(element:HTMLElement,x1:number,y1:number,x2:number,y2:number)=>{
   x1=Math.max(x1,viewport.left);x2=Math.min(x2,viewport.right);y1=Math.max(y1,top);y2=Math.min(y2,bottom);
   element.hidden=!box.width||!box.height||x2<=x1||y2<=y1;
   const coordinates={left:`${(x1-viewport.left)/scale-this.host.clientLeft+this.host.scrollLeft}px`,top:`${(y1-viewport.top)/scale-this.host.clientTop+this.host.scrollTop}px`,width:`${Math.max(0,x2-x1)/scale}px`,height:`${Math.max(0,y2-y1)/scale}px`};
   for(const [property,value] of Object.entries(coordinates))if(element.style.getPropertyValue(property)!==value)element.style.setProperty(property,value);
  };
  place(this.column,Math.max(box.left,clipLeft),box.top-edge,Math.min(box.right,clipRight),box.top+edge);
  place(this.row,box.left-edge,box.top,box.left+edge,box.bottom);
  if(box.left<clipLeft)this.row.hidden=true;
 };
 destroy():void {if(!controls.delete(this))return;this.resize?.disconnect();if(this.frame!==null)this.document.defaultView!.cancelAnimationFrame(this.frame);this.frame=null;this.document.removeEventListener('scroll',this.position,true);this.document.removeEventListener('contextmenu',this.contextMenu,true);this.document.defaultView!.removeEventListener('resize',this.position);for(const element of [this.row,this.column]){owners.delete(element);widgets.delete(element);element.remove();}releaseHost(this.host,this);}
}
