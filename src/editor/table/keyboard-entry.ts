import {EditorSelection,type EditorState,type Extension} from '@codemirror/state';
import {EditorView,ViewPlugin} from '@codemirror/view';
import {getParagraphProjectionState} from '../paragraph/projection';
import {classifyCurrentSelectionMode,requireCompositionState} from '../runtime/input-state';
import {requireGoalXStore} from '../runtime/navigation-core';
import {findEditableTableSources} from './edit-session';
import type {TableEditingOptions} from './editing-types';
import {activateNativeCell} from './focus-handoff';
import {projectQuoteContent} from '../callout/projection';
import {quoteContainers} from '../callout/presentation-model';
import {getStructuredListProjectionState,getStructuredListSelectionTransparentRanges} from '../structured-list/projection';
import {bodyTabDelimiterOffset} from '../literal-tab';

/** DOM order differs from the bottom-right logical cell when a cell spans rows. */
export function lastTableCell(table:HTMLTableElement):HTMLTableCellElement {
 const bottom=Array.from(table.querySelectorAll<HTMLTableCellElement>('td,th'))
  .filter(cell=>cell.closest('table')===table&&(cell.parentElement as HTMLTableRowElement).rowIndex+cell.rowSpan===table.rows.length);
 return bottom.reduce((best,cell)=>Number(cell.dataset.pfColumn??cell.cellIndex)>Number(best.dataset.pfColumn??best.cellIndex)?cell:best);
}

export function tableRowCell(table:HTMLTableElement,row:number,x:number):HTMLTableCellElement|null {
 const cells=Array.from(table.querySelectorAll<HTMLTableCellElement>('td,th')).filter(cell=>cell.closest('table')===table);
 // A spanning cell can own the last logical row without appearing in the last DOM row.
 const last=cells.filter(cell=>{const start=(cell.parentElement as HTMLTableRowElement).rowIndex;return start<=row&&row<start+cell.rowSpan;});
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

export function enterTableCell(view:EditorView,cell:HTMLTableCellElement,x:number,forward=false,horizontal=false):boolean {
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
export function enterFollowingTable(view:EditorView,from:number,forward=true,goal?:number):boolean {
 const wrapper=Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-table-widget,.paraflow-html-table-editor'))
  .find(element=>element.classList.contains('cm-table-widget')?view.posAtDOM(element)===from:Number(element.dataset.pfTableFrom)===from);
 const table=wrapper?.querySelector('table');
 const x=goal===undefined?undefined:view.contentDOM.getBoundingClientRect().left+goal;
 const cell=table?(x===undefined?(forward?table.querySelector<HTMLTableCellElement>('td,th'):lastTableCell(table)):
  tableRowCell(table,forward?0:table.rows.length-1,x)):null;
 if(!cell)return false;
 const box=cell.getBoundingClientRect();
 return enterTableCell(view,cell,x??(forward?box.left+1:box.right-1),forward,x===undefined);
}

export function keyboardAdjacentTable(state:EditorState,head:number,forward:boolean) {
 const line=state.doc.lineAt(head),projection=getParagraphProjectionState(state)!;
 const gap=[...projection.rangeIndex.gaps,...getStructuredListSelectionTransparentRanges(state)].find(gap=>forward?gap.from===line.to:gap.to===line.from);
 return findEditableTableSources(state).find(source=>{
  if(source.container?.kind==='quote')return false;
  if(forward?source.from===(gap?.to??line.to+1):source.to===(gap?.from??line.from-1)||!!gap&&gap.from===source.to+1&&line.from===source.to+2)return true;
  // Code owns its body, so paragraph authority does not index its separator.
  // One blank row still separates adjacent blocks; longer runs are editable bodies.
  const from=forward?line.to:source.to,to=forward?source.from:line.from;
  return from<to&&/^\n[ \t]*\n$/u.test(state.sliceDoc(from,to));
 });
}

/** Transfer the caret before the host commits its intermediate table/gap endpoint. */
export function createTableKeyboardEntry(options:TableEditingOptions):Extension {
 return ViewPlugin.define(view=>{
  const capture=(event:KeyboardEvent)=>{
   if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)||event.defaultPrevented||event.shiftKey||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||view.composing||
      !options.isActive(view)||options.isActiveView?.(view)===false||
      !view.dom.classList.contains('paraflow-paragraph-editing-active')||
      (event.target as Element).closest('td,th'))return;
   const current=view.state.selection.main;
   const card=quoteContainers(view.state).filter(card=>card.from<=current.head&&current.head<=card.to).sort((a,b)=>b.depth-a.depth)[0];
   const container=card?projectQuoteContent(view.state,card.kind==='callout'?card.headerTo+1:card.from,card.to,card.depth):null;
   const state=container?.state??view.state;
   const projection=getParagraphProjectionState(state);
   if(!projection?.authority.complete||requireCompositionState(view.state)||classifyCurrentSelectionMode(view.state)!=='caret')return;
   const mapped=container?.lines.find(line=>line.from<=current.head&&current.head<=line.from+line.prefix.length+line.text.length);
   if(container&&(!mapped||current.head<mapped.from+mapped.prefix.length))return;
   const head=mapped?mapped.virtualFrom+current.head-mapped.from-mapped.prefix.length:current.head,line=state.doc.lineAt(head);
   const bodyFrom=getStructuredListProjectionState(state)?.rangeIndex.protectedRanges.find(range=>range.from===line.from)?.to??
    line.from+(bodyTabDelimiterOffset(line.text)===0?1:0);
   const forward=event.key==='ArrowDown'||event.key==='ArrowRight',horizontal=event.key==='ArrowLeft'||event.key==='ArrowRight';
   if(horizontal&&head!==(forward?line.to:bodyFrom))return;
   const target=keyboardAdjacentTable(state,head,forward);
   if(!target)return;
   const source=container?{...target,from:view.state.doc.lineAt(container.toSource(target.from)).from,to:container.toSource(target.to)}:target;
   const store=requireGoalXStore(view),coordinates=view.coordsAtPos(current.head,current.assoc<0?-1:1);
   if(!coordinates)return;
   const contentLeft=view.contentDOM.getBoundingClientRect().left;
   const goal=store.read()??current.goalColumn??coordinates.left-contentLeft;
   if(!horizontal){
    const candidate=view.moveVertically(EditorSelection.cursor(current.head,current.assoc,undefined,goal),forward);
    const lineFrom=container?.toSource(line.from)??line.from,lineTo=container?.toSource(line.to)??line.to;
    // Atomic table widgets may skip their whole source range in the outer editor.
    if(forward?candidate.head<=lineTo:candidate.head>=lineFrom)return;
   }
   const wrapper=Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-table-widget,.paraflow-html-table-editor'))
    .find(element=>element.classList.contains('cm-table-widget')?view.posAtDOM(element)===source.from:Number(element.dataset.pfTableFrom)===source.from);
   const table=wrapper?.querySelector('table');if(!table)return;
   const cells=Array.from(table.querySelectorAll<HTMLTableCellElement>('td,th')).filter(cell=>cell.closest('table')===table);
   const cell=horizontal?(forward?cells[0]:lastTableCell(table)):tableRowCell(table,forward?0:table.rows.length-1,contentLeft+goal);
   if(!cell||!enterTableCell(view,cell,contentLeft+goal,forward,horizontal))return;
   store.write(horizontal?null:goal);event.preventDefault();event.stopPropagation();
  };
  view.dom.addEventListener('keydown',capture,true);
  return {destroy(){view.dom.removeEventListener('keydown',capture,true);}};
 });
}
