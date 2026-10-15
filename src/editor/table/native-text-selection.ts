import {EditorView} from '@codemirror/view';
import {bookmarkRange} from './action-target';
import {mapRenderedTextSelection} from './markdown-selection';

interface PendingTextSelection {
 widget:HTMLElement;
 row:number;
 column:number;
 text:string;
 from:number;
 to:number;
 backward:boolean;
}

/** Preserve cell text ownership through native activation and Source-mode teardown. */
export class NativeTableTextSelection {
 private pressed:HTMLTableCellElement|null=null;
 private pending:PendingTextSelection|null=null;
 private focusedContent:HTMLElement|null=null;
 constructor(private readonly view:EditorView,private readonly isActive:()=>boolean,private readonly canFocusSource:()=>boolean=()=>!isActive()){
  view.dom.ownerDocument.addEventListener('pointerdown',this.down,true);
  view.dom.ownerDocument.addEventListener('focusin',this.focusIn,true);
  view.dom.addEventListener('click',this.click,true);
 }
 private focusIn=(event:FocusEvent):void=>{
  const target=event.target as HTMLElement;
  if(target===this.view.dom.ownerDocument.body)return;
  const tableContent=target.matches('.cm-content')&&target.closest('.cm-table-widget')||target.matches('.paraflow-html-table-editor td,.paraflow-html-table-editor th');
  this.focusedContent=this.isActive()&&tableContent&&this.view.dom.contains(target)?target:null;
 };
 private down=(event:PointerEvent):void=>{
  this.pressed=null;this.pending=null;
  if(!this.isActive()||event.button!==0||event.shiftKey||event.ctrlKey||event.metaKey||event.altKey)return;
  const cell=(event.target as Element).closest<HTMLTableCellElement>('.cm-table-widget td,.cm-table-widget th');
  if(cell&&this.view.dom.contains(cell)&&!cell.querySelector('.cm-content'))this.pressed=cell;
 };
 private click=(event:MouseEvent):void=>{
  const cell=this.pressed;this.pressed=null;
  if(!cell||!this.isActive()||event.button!==0||event.detail>1||!cell.contains(event.target as Node)||cell.querySelector('.cm-content'))return;
  const selection=cell.ownerDocument.getSelection();
  if(!selection?.rangeCount||selection.isCollapsed||cell.closest('table')!.querySelector('.is-selected'))return;
  const range=selection.getRangeAt(0),content=cell.querySelector<HTMLElement>('.table-cell-wrapper')??cell;
  if(!content.contains(range.startContainer)||!content.contains(range.endContainer))return;
  const offsets=bookmarkRange(content,range);
  this.pending={widget:cell.closest<HTMLElement>('.cm-table-widget')!,row:(cell.parentElement as HTMLTableRowElement).rowIndex,column:cell.cellIndex,
   text:content.textContent??'',...offsets,backward:selection.anchorNode===range.endContainer&&selection.anchorOffset===range.endOffset};
 };
 refresh():void {
  const focused=this.focusedContent;
  if(focused&&!focused.isConnected){
   this.focusedContent=null;
   // The host's activeCM still names the destroyed native cell during mode focus.
   if(this.canFocusSource()&&this.view.dom.isConnected&&this.view.dom.ownerDocument.activeElement===this.view.dom.ownerDocument.body)this.view.focus();
  }
  const pending=this.pending;if(!pending)return;
  if(!this.isActive()||!this.view.dom.contains(pending.widget)){this.pending=null;return;}
  const table=pending.widget.querySelector('table')!,cell=table.rows[pending.row]?.cells[pending.column];
  if(!cell||table.querySelector('.is-selected')){this.pending=null;return;}
  const content=cell.querySelector<HTMLElement>('.cm-content');if(!content)return;
  this.pending=null;
  const nested=EditorView.findFromDOM(content);
  if(!nested||nested===this.view||!nested.state.selection.main.empty||!nested.dom.contains(content.ownerDocument.activeElement))return;
  const source=nested.state.doc.toString(),offsets=source===pending.text?pending:mapRenderedTextSelection(source,pending.from,pending.to,pending.text);
  if(!offsets)return;
  nested.dispatch({selection:{anchor:pending.backward?offsets.to:offsets.from,head:pending.backward?offsets.from:offsets.to},userEvent:'select.pointer'});
 }
 destroy():void {
  this.pressed=null;this.pending=null;
  this.focusedContent=null;
  this.view.dom.ownerDocument.removeEventListener('pointerdown',this.down,true);
  this.view.dom.ownerDocument.removeEventListener('focusin',this.focusIn,true);
  this.view.dom.removeEventListener('click',this.click,true);
 }
}
