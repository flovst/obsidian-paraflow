import { createDetachedEl } from '../../dom';
import {Facet,type Text as DocumentText,type Transaction} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {bookmarkRange,type TextBookmark} from './action-target';
import {findEditableTableSources,TableEditSession} from './edit-session';
import {TableSerializationError} from './serialization';
import {admittedFragment} from './admitted-dom';
import {mapMarkdownTextSelection,mapRenderedTextSelection} from './markdown-selection';
import type {CellPosition,CellRectangle} from './model';
import {markdownCellSourceEnd} from './toolbar-source';

export interface TableFocusBookmark extends TextBookmark {readonly text:string;readonly rectangle?:CellRectangle;}
interface PendingFocus {doc:DocumentText;from:number;bookmark:TableFocusBookmark;hideOuterCaret:boolean;}
const pending=new WeakMap<EditorView,PendingFocus>();
const completedHtmlActivation=new WeakMap<EditorView,PendingFocus>();
export const tableFocusOwner=Facet.define<(view:EditorView)=>boolean>();

/** A folded gap resolves to a logical cell, never the table's hidden source edge. */
export function tableActivationDestination(view:EditorView,position:number):{from:number;position:number;bookmark:TableFocusBookmark}|null {
 if(!view.state.facet(tableFocusOwner).some(owner=>owner(view)))return null;
 const source=findEditableTableSources(view.state).find(source=>source.to===position);if(!source)return null;
 let session:TableEditSession;
 try{session=new TableEditSession(source);}catch(error){if(error instanceof TableSerializationError)return null;throw error;}
 const table=session.table;
 const cell=table.cells.find(cell=>cell.row+cell.rowSpan===table.rows&&cell.column+cell.columnSpan===table.columns)!;
 const text=admittedFragment(view.dom.ownerDocument,cell.html).textContent??'';
 const destination=source.kind==='markdown'&&!source.container?source.from+markdownCellSourceEnd(source.source,cell.row,cell.column):source.from;
 return {from:source.from,position:destination,bookmark:{cell:{row:cell.row,column:cell.column},from:text.length,to:text.length,text}};
}

/** Store logical cell/text coordinates; replacement DOM belongs to the view lifecycle. */
export function captureTableFocus(cell:HTMLElement,position:CellPosition,html:string):TableFocusBookmark {
 cell=cell.querySelector<HTMLElement>('.cm-content')??cell;
 const plain=createDetachedEl(cell.ownerDocument, 'div');plain.append(admittedFragment(cell.ownerDocument,html));const text=plain.textContent??'';
 const selection=cell.ownerDocument.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;
 const offsets=range&&cell.contains(range.startContainer)&&cell.contains(range.endContainer)?bookmarkRange(cell,range):{from:0,to:0};
 const mapped=cell.textContent===text?offsets:mapMarkdownTextSelection(cell.textContent??'',offsets.from,offsets.to,text);
 if(!mapped)throw new Error('当前文字选区不能无损映射，请在单元格正文中重新选择文字。');
 return {cell:{row:position.row,column:position.column},text,...mapped};
}
export function requestTableFocus(view:EditorView,transaction:Transaction,from:number,bookmark:TableFocusBookmark,hideOuterCaret=false):void {pending.set(view,{doc:transaction.state.doc,from,bookmark,hideOuterCaret});if(hideOuterCaret)view.dom.classList.add('paraflow-table-focus-pending');}
export function clearTableFocus(view:EditorView):void {pending.delete(view);completedHtmlActivation.delete(view);view.dom.classList.remove('paraflow-table-focus-pending');}
export function clearTableActivationResume(view:EditorView):void {completedHtmlActivation.delete(view);}
/** The host finalizes a mode change by focusing its outer CM after our cell has mounted. */
export function resumeHtmlActivationFocus(view:EditorView,restoreHtml:(from:number,bookmark:TableFocusBookmark)=>boolean):boolean {
 const request=completedHtmlActivation.get(view);completedHtmlActivation.delete(view);if(!request)return false;
 const selection=view.state.selection.main;
 return view.state.doc===request.doc&&selection.empty&&selection.head===request.from&&restoreHtml(request.from,request.bookmark);
}
export function updateTableFocusBookmark(view:EditorView,bookmark:TextBookmark):boolean {const value=pending.get(view);if(!value)return false;value.bookmark={...value.bookmark,...bookmark};return true;}
export function hasTableFocusRequest(view:EditorView):boolean {return pending.has(view);}
export function hasTableActivationRequest(view:EditorView):boolean {return pending.get(view)?.hideOuterCaret??false;}

export function activateNativeCell(cell:HTMLTableCellElement,shiftKey=false,point?:{x:number;y:number}):void {
 const target=cell.querySelector<HTMLElement>('.table-cell-wrapper')??cell,win=cell.ownerDocument.defaultView!,box=cell.getBoundingClientRect();
 const event={bubbles:true,cancelable:true,view:win,isPrimary:true,pointerId:1,pointerType:'mouse',button:0,shiftKey,clientX:point?.x??box.left+box.width/2,clientY:point?.y??box.top+box.height/2};
 target.dispatchEvent(new win.PointerEvent('pointerdown',{...event,buttons:1}));
 target.dispatchEvent(new win.PointerEvent('pointerup',{...event,buttons:0}));
 target.dispatchEvent(new win.MouseEvent('click',{...event,detail:1}));
}

export function nativeFocusRectangle(cell:HTMLElement):CellRectangle|undefined {
 const selected=Array.from(cell.closest('table')!.querySelectorAll<HTMLTableCellElement>('td.is-selected,th.is-selected'));if(selected.length<2)return undefined;
 const rows=selected.map(cell=>(cell.parentElement as HTMLTableRowElement).rowIndex),columns=selected.map(cell=>cell.cellIndex);
 return {top:Math.min(...rows),bottom:Math.max(...rows),left:Math.min(...columns),right:Math.max(...columns)};
}

export function restoreTableFocus(view:EditorView,active:boolean,restoreHtml:(from:number,bookmark:TableFocusBookmark)=>boolean):boolean {
 const request=pending.get(view);if(!request)return false;
 const selection=view.state.selection.main;
 const source=findEditableTableSources(view.state).find(source=>source.from===request.from);if(!source){clearTableFocus(view);return false;}
 // Native LP activation maps the table boundary to its first cell's source offset.
 const ownsSelection=selection.head===request.from||selection.head===source.to||request.hideOuterCaret&&source.from<=selection.head&&selection.head<=source.to;
 if(!active||view.state.doc!==request.doc||!selection.empty||!ownsSelection){clearTableFocus(view);return false;}
 if(source.kind==='html'||source.container){pending.delete(view);if(restoreHtml(request.from,request.bookmark)){clearTableFocus(view);if(request.hideOuterCaret)completedHtmlActivation.set(view,request);return true;}pending.set(view,request);return false;}
 const widget=Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-table-widget')).find(widget=>view.posAtDOM(widget)===source.from);if(!widget)return false;
 const position=request.bookmark.cell,table=widget.querySelector('table')!;const row=table.rows[Math.min(position.row,table.rows.length-1)]!,cell=row.cells[Math.min(position.column,row.cells.length-1)];
 if(!cell)return false;
 pending.delete(view);
 if(!cell.querySelector('.cm-content')){
  // Native cells create their editor through the public pointer/click interaction.
  activateNativeCell(cell);
 }
 const content=cell.querySelector<HTMLElement>('.cm-content');
 const nested=content?EditorView.findFromDOM(content):null;
 if(!nested||nested===view){pending.set(view,request);if(request.hideOuterCaret)view.dom.classList.add('paraflow-table-focus-pending');return false;}
 const text=nested.state.doc.toString(),bookmark=request.bookmark;
 const offsets=text===bookmark.text?bookmark:mapRenderedTextSelection(text,bookmark.from,bookmark.to,bookmark.text);
 if(!offsets){clearTableFocus(view);return false;}
 const current=nested.state.selection;
 if(current.ranges.length!==1||current.main.anchor!==offsets.from||current.main.head!==offsets.to)nested.dispatch({selection:{anchor:offsets.from,head:offsets.to}});
 if(!nested.hasFocus)nested.focus();
 const rectangle=bookmark.rectangle;
 if(rectangle){const opposite=table.rows[position.row===rectangle.top?rectangle.bottom:rectangle.top]?.cells[position.column===rectangle.left?rectangle.right:rectangle.left];if(opposite)activateNativeCell(opposite,true);}
 clearTableFocus(view);return true;
}
