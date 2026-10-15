import {EditorSelection,type Extension} from '@codemirror/state';
import {EditorView,ViewPlugin} from '@codemirror/view';
import {getParagraphProjectionState} from '../paragraph/projection';
import {classifyCurrentSelectionMode,requireCompositionState} from '../runtime/input-state';
import {requireGoalXStore} from '../runtime/navigation-core';
import {findEditableTableSources} from './edit-session';
import type {TableEditingOptions} from './editing-types';
import {activateNativeCell} from './focus-handoff';

/** DOM order differs from the bottom-right logical cell when a cell spans rows. */
export function lastTableCell(table:HTMLTableElement):HTMLTableCellElement {
 const bottom=Array.from(table.querySelectorAll<HTMLTableCellElement>('td,th'))
  .filter(cell=>cell.closest('table')===table&&(cell.parentElement as HTMLTableRowElement).rowIndex+cell.rowSpan===table.rows.length);
 return bottom.reduce((best,cell)=>Number(cell.dataset.pfColumn??cell.cellIndex)>Number(best.dataset.pfColumn??best.cellIndex)?cell:best);
}

function lastRowCell(table:HTMLTableElement,x:number):HTMLTableCellElement|null {
 const cells=Array.from(table.querySelectorAll<HTMLTableCellElement>('td,th')).filter(cell=>cell.closest('table')===table);
 // A spanning cell can own the last logical row without appearing in the last DOM row.
 const last=cells.filter(cell=>(cell.parentElement as HTMLTableRowElement).rowIndex+cell.rowSpan===table.rows.length);
 return last.reduce<HTMLTableCellElement|null>((best,cell)=>{
  const distance=(candidate:HTMLTableCellElement)=>{const box=candidate.getBoundingClientRect();return Math.max(box.left-x,0,x-box.right);};
  return !best||distance(cell)<distance(best)?cell:best;
 },null);
}

function cellEntryPoint(cell:HTMLTableCellElement,x:number,forward=false):{x:number;y:number} {
 const range=cell.ownerDocument.createRange();range.selectNodeContents(cell.querySelector('.table-cell-wrapper')??cell);
 const boxes=Array.from(range.getClientRects()).filter(box=>box.height>0);
 const last=boxes.reduce<DOMRect|null>((best,box)=>!best||(forward?box.top<best.top:box.bottom>best.bottom)?box:best,null);
 const box=cell.getBoundingClientRect(),style=cell.ownerDocument.defaultView!.getComputedStyle(cell);
 const left=box.left+parseFloat(style.paddingLeft||'0'),right=box.right-parseFloat(style.paddingRight||'0');
 return {x:Math.max(left,Math.min(right-1,x)),y:last?(last.top+last.bottom)/2:(box.top+box.bottom)/2};
}

function enterCell(view:EditorView,cell:HTMLTableCellElement,x:number,forward=false,horizontal=false):boolean {
 if(cell.closest('.cm-table-widget')){
  const activated=!cell.querySelector('.cm-content');
  if(activated)activateNativeCell(cell,false,cellEntryPoint(cell,x,forward));
  const content=cell.querySelector<HTMLElement>('.cm-content');
  const nested=content?EditorView.findFromDOM(content):null;
  // Native activation may create its editor at the event's microtask checkpoint.
  // Its click already carries the caret coordinates; the original Up is consumed.
  if(!nested||nested===view){
   if(activated&&horizontal)queueMicrotask(()=>{
    const mounted=cell.querySelector<HTMLElement>('.cm-content'),editor=mounted?EditorView.findFromDOM(mounted):null;
    if(!cell.isConnected||!editor||editor===view||!cell.contains(cell.ownerDocument.activeElement))return;
    editor.dispatch({selection:EditorSelection.cursor(forward?0:editor.state.doc.length),userEvent:'select'});
   });
   return activated;
  }
  const end=forward?0:nested.state.doc.length,box=nested.coordsAtPos(end);
  const head=!horizontal&&box?nested.posAtCoords({x,y:(box.top+box.bottom)/2})??end:end;
  nested.dispatch({selection:EditorSelection.cursor(head),userEvent:'select'});
  nested.focus();return true;
 }
 cell.focus();
 const doc=cell.ownerDocument,range=doc.createRange();range.selectNodeContents(cell);
 const point=cellEntryPoint(cell,x,forward),hit=horizontal?null:doc.caretPositionFromPoint(point.x,point.y);
 if(!horizontal&&hit&&cell.contains(hit.offsetNode)){range.setStart(hit.offsetNode,hit.offset);range.collapse(true);}
 else range.collapse(forward);
 const selection=doc.getSelection()!;selection.removeAllRanges();selection.addRange(range);return true;
}

/** A block exit can enter a rendered table without committing its source edge as a caret. */
export function enterFollowingTable(view:EditorView,from:number,forward=true):boolean {
 const wrapper=Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-table-widget,.paraflow-html-table-editor'))
  .find(element=>element.classList.contains('cm-table-widget')?view.posAtDOM(element)===from:Number(element.dataset.pfTableFrom)===from);
 const table=wrapper?.querySelector('table');
 const cell=table?(forward?table.querySelector<HTMLTableCellElement>('td,th'):lastTableCell(table)):null;
 if(!cell)return false;
 const box=cell.getBoundingClientRect();
 return enterCell(view,cell,forward?box.left+1:box.right-1,forward,true);
}

/** Transfer the caret before the host commits its intermediate table/gap endpoint. */
export function createTableKeyboardEntry(options:TableEditingOptions):Extension {
 return ViewPlugin.define(view=>{
  const capture=(event:KeyboardEvent)=>{
   if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)||event.defaultPrevented||event.shiftKey||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||view.composing||
      !options.isActive(view)||options.isActiveView?.(view)===false||
      !view.dom.classList.contains('paraflow-paragraph-editing-active')||
      (event.target as Element).closest('td,th'))return;
   const projection=getParagraphProjectionState(view.state);
   if(!projection?.authority.complete||requireCompositionState(view.state)||classifyCurrentSelectionMode(view.state)!=='caret')return;
   const current=view.state.selection.main,line=view.state.doc.lineAt(current.head);
   const forward=event.key==='ArrowDown'||event.key==='ArrowRight',horizontal=event.key==='ArrowLeft'||event.key==='ArrowRight';
   if(horizontal&&current.head!==(forward?line.to:line.from))return;
   const gap=projection.rangeIndex.gaps.find(gap=>forward?gap.from===line.to:gap.to===line.from);
   const source=findEditableTableSources(view.state).find(source=>!source.container&&(forward?
    source.from===(gap?.to??line.to+1):source.to===(gap?.from??line.from-1)||!!gap&&gap.from===source.to+1&&line.from===source.to+2));
   if(!source)return;
   const store=requireGoalXStore(view),coordinates=view.coordsAtPos(current.head,current.assoc<0?-1:1);
   if(!coordinates)return;
   const contentLeft=view.contentDOM.getBoundingClientRect().left;
   const goal=store.read()??current.goalColumn??coordinates.left-contentLeft;
   if(!horizontal){
    const candidate=view.moveVertically(EditorSelection.cursor(current.head,current.assoc,undefined,goal),forward);
    if(forward?candidate.head<=line.to||candidate.head>source.to:candidate.head>=line.from||candidate.head<source.from)return;
   }
   const wrapper=Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-table-widget,.paraflow-html-table-editor'))
    .find(element=>element.classList.contains('cm-table-widget')?view.posAtDOM(element)===source.from:Number(element.dataset.pfTableFrom)===source.from);
   const table=wrapper?.querySelector('table');if(!table)return;
   const cells=Array.from(table.querySelectorAll<HTMLTableCellElement>('td,th')).filter(cell=>cell.closest('table')===table);
   const cell=horizontal?(forward?cells[0]:lastTableCell(table)):forward?
    Array.from(table.rows[0]!.cells).reduce((best,cell)=>Math.abs(cell.getBoundingClientRect().left-contentLeft-goal)<Math.abs(best.getBoundingClientRect().left-contentLeft-goal)?cell:best):lastRowCell(table,contentLeft+goal);
   if(!cell||!enterCell(view,cell,contentLeft+goal,forward,horizontal))return;
   store.write(horizontal?null:goal);event.preventDefault();event.stopPropagation();
  };
  view.dom.addEventListener('keydown',capture,true);
  return {destroy(){view.dom.removeEventListener('keydown',capture,true);}};
 });
}
