import {tableEdgeAxis} from './edge-hit';
import {TableAddControls} from './add-controls';
import {TableOuterDragCursor} from './outer-drag-cursor';

const nativeHandleDisplay='flex';

/** Native nodes retain their host listeners; a shared outer layer delegates additions. */
export class NativeTableControls {
 private readonly widgets=new Map<HTMLElement,TableAddControls|null>();
 private readonly cursor:TableOuterDragCursor;
 constructor(private readonly root:HTMLElement,private readonly hidden:()=>boolean,private readonly isActive:()=>boolean=()=>true){this.cursor=new TableOuterDragCursor(root.ownerDocument,event=>this.outerHandle(event)?.axis??null);root.ownerDocument.addEventListener('pointerdown',this.outerPointerDown,true);}
 private outerHandle(event:MouseEvent):{handle:HTMLElement;axis:'row'|'column'}|null {
  if(!this.isActive()||event.defaultPrevented)return null;
  const target=event.target as Element;if(target.closest?.('.paraflow-table-toolbar,.paraflow-table-menu,.paraflow-table-size-popup,.menu,.modal,.modal-container,input,textarea,button,select,.table-row-drag-handle,.table-col-drag-handle'))return null;
  const win=this.root.ownerDocument.defaultView!,edge=(Number.parseFloat(win.getComputedStyle(this.root.querySelector('.cm-content')??this.root).fontSize)||16)*.35;
  const viewport=this.root.querySelector('.cm-scroller')!.getBoundingClientRect();
  if(event.clientX<viewport.left||event.clientX>viewport.right||event.clientY<viewport.top||event.clientY>viewport.bottom)return null;
  for(const widget of this.widgets.keys()){
   const table=widget.querySelector('table')!;const box=table.getBoundingClientRect(),clip=widget.getBoundingClientRect();if(!box.width||!box.height)continue;
   const axis=tableEdgeAxis(event.clientX,event.clientY,box,clip,edge);
   if(!axis)continue;
   const handle=Array.from(widget.querySelectorAll<HTMLElement>(axis==='row'?'.table-row-drag-handle':'.table-col-drag-handle')).find(element=>{const cell=element.closest('td,th')!.getBoundingClientRect();return axis==='row'?event.clientY>=cell.top&&event.clientY<=cell.bottom:event.clientX>=cell.left&&event.clientX<=cell.right;});
   if(!handle)continue;
   return {handle,axis};
  }
  return null;
 }
 private outerPointerDown=(event:PointerEvent):void=>{
  if(event.button!==0||!event.isPrimary)return;const hit=this.outerHandle(event);if(!hit)return;
  event.preventDefault();event.stopPropagation();const win=this.root.ownerDocument.defaultView!;
  const {handle}=hit,display=handle.style.getPropertyValue('display'),priority=handle.style.getPropertyPriority('display'),hadStyle=handle.hasAttribute('style');
  // Forwarded events have no :active state; the host hides other handles before measuring.
  handle.style.setProperty('display',nativeHandleDisplay,'important');
  try{handle.dispatchEvent(new win.PointerEvent('pointerdown',{bubbles:true,cancelable:true,view:win,isPrimary:true,pointerId:event.pointerId,pointerType:event.pointerType,button:event.button,buttons:event.buttons,clientX:event.clientX,clientY:event.clientY,screenX:event.screenX,screenY:event.screenY,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey,altKey:event.altKey,metaKey:event.metaKey}));}
  finally{if(display)handle.style.setProperty('display',display,priority);else handle.style.removeProperty('display');if(!hadStyle&&!handle.style.length)handle.removeAttribute('style');}
 };
 update(enabled=true):void {
  this.cursor.clear();
  const current=new Set(enabled?this.root.querySelectorAll<HTMLElement>('.cm-table-widget'):[]);
  for(const [widget,controls] of this.widgets)if(!current.has(widget)){controls?.destroy();widget.classList.remove('paraflow-table-controls');this.widgets.delete(widget);}
  for(const widget of current){
   widget.classList.add('paraflow-table-controls');let controls=this.widgets.get(widget)??null;
   if(this.hidden()){controls?.destroy();controls=null;}
   else if(!controls&&widget.querySelector('table'))controls=new TableAddControls(widget,()=>widget.querySelector('table')!,axis=>{widget.querySelector<HTMLElement>(axis==='row'?'.table-row-btn':'.table-col-btn')!.click();},this.isActive);
   this.widgets.set(widget,controls);
  }
 }
 destroy():void {this.cursor.destroy();this.root.ownerDocument.removeEventListener('pointerdown',this.outerPointerDown,true);this.update(false);}
}
