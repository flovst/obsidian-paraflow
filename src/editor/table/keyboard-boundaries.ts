import {EditorSelection,StateEffect,type Extension,type TransactionSpec} from '@codemirror/state';
import {EditorView,ViewPlugin} from '@codemirror/view';
import {invertedEffects,isolateHistory} from '@codemirror/commands';
import {blockExitPlan} from '../block-exit';
import {normalizeParagraphSelectionEndpoint} from '../paragraph/selection-protection';
import {requireCompositionState,selectionModeAnnotation} from '../runtime/input-state';
import {requireGoalXStore} from '../runtime/navigation-core';
import {bookmarkRange} from './action-target';
import {findEditableTableSources,TableEditSession,type TableSource} from './edit-session';
import type {TableEditingOptions} from './editing-types';
import {admittedFragment} from './admitted-dom';
import {enterFollowingTable,lastTableCell} from './keyboard-entry';
import {enterVirtualTail} from '../runtime/virtual-tail';

const emptyTableHistory=StateEffect.define<{from:number;restore:boolean}>({map:(value,changes)=>({...value,from:changes.mapPos(value.from)})});

function cellCaret(view:EditorView,cell:HTMLTableCellElement,measure:boolean):{start:boolean;end:boolean;top:boolean;x:number}|null {
 const content=cell.querySelector<HTMLElement>('.cm-content'),nested=content?EditorView.findFromDOM(content):null;
 if(nested&&nested!==view){
  const selection=nested.state.selection;
  if(selection.ranges.length!==1||!selection.main.empty||nested.composing||nested.state.readOnly)return null;
  const head=selection.main.head,point=measure?nested.coordsAtPos(head):null,first=measure?nested.coordsAtPos(0):null;
  return {start:head===0,end:head===nested.state.doc.length,top:!!point&&!!first&&point.top<first.bottom,x:point?.left??(measure?cell.getBoundingClientRect().left:0)};
 }
 const selection=cell.ownerDocument.getSelection();
 if(!selection?.isCollapsed||selection.rangeCount!==1||!cell.contains(selection.focusNode))return null;
 const range=selection.getRangeAt(0),offset=bookmarkRange(cell,range).from;
 const point=measure?Array.from(range.getClientRects()).find(box=>box.height>0):undefined;
 const body=cell.ownerDocument.createRange();body.selectNodeContents(cell);
 const boxes=measure?Array.from(body.getClientRects()).filter(box=>box.height>0):[];
 return {start:offset===0,end:offset===cell.textContent.length,
  top:boxes.length===0?!cell.textContent:!!point&&point.top+point.height/2<Math.min(...boxes.map(box=>box.bottom)),
  x:point?.left??(measure?cell.getBoundingClientRect().left:0)};
}

/** Remove one empty construct and its following separator, retaining existing surrounding prose. */
function emptyTableDeletion(view:EditorView,source:TableSource):TransactionSpec|null {
 const session=new TableEditSession(source);
 for(const cell of session.table.cells){
  const fragment=admittedFragment(view.dom.ownerDocument,cell.html);
  if(fragment.textContent||fragment.querySelector(':not(br)')||fragment.querySelectorAll('br').length>1)return null;
 }
 const prefix=source.container?.prefixes[0]??'';
 const last=view.state.doc.lineAt(source.to);
 let to=source.to,insert=prefix;
 if(last.number<view.state.doc.lines){
  const next=view.state.doc.line(last.number+1);
  to=next.from;
  if(next.text===prefix&&next.number<view.state.doc.lines)to=view.state.doc.line(next.number+1).from;
  insert='';
 }
 return {changes:{from:source.from,to,insert},selection:EditorSelection.cursor(source.from+insert.length),effects:emptyTableHistory.of({from:source.from,restore:false}),
  annotations:[selectionModeAnnotation.of('normal'),isolateHistory.of('full')],userEvent:'delete.table',scrollIntoView:true};
}

/** A cell editor owns text movement; the outer table owns only its external boundaries. */
export function createTableKeyboardBoundaries(options:TableEditingOptions,deleteCaretRow:(view:EditorView,cell:HTMLTableCellElement)=>boolean,insertCaretRow?:(view:EditorView,cell:HTMLTableCellElement)=>boolean):Extension {
 return [invertedEffects.of(transaction=>transaction.effects.filter(effect=>effect.is(emptyTableHistory))
  .map(effect=>emptyTableHistory.of({from:transaction.changes.invertedDesc.mapPos(effect.value.from),restore:!effect.value.restore}))),ViewPlugin.define(view=>{
  let destroyed=false;
  const capture=(event:KeyboardEvent)=>{
   const rowDelete=event.key==='Backspace'&&event.shiftKey&&(event.ctrlKey||event.metaKey)&&!event.altKey;
   const enter=event.key==='Enter'&&!event.shiftKey&&!event.altKey;
   if(!['ArrowLeft','ArrowRight','ArrowUp','Backspace','Enter'].includes(event.key)||event.defaultPrevented||view.state.readOnly||
    (!rowDelete&&!enter&&(event.shiftKey||event.altKey||event.ctrlKey||event.metaKey))||event.isComposing||view.composing||
    !options.isActive(view)||options.isActiveView?.(view)===false||requireCompositionState(view.state)||
    (!rowDelete&&!enter&&!view.dom.classList.contains('paraflow-paragraph-editing-active')))return;
   const cell=(event.target as Element).closest<HTMLTableCellElement>('td,th');
   const wrapper=cell?.closest<HTMLElement>('.cm-table-widget,.paraflow-html-table-editor');
   if(!cell||!wrapper||!view.dom.contains(wrapper))return;
   const table=cell.closest('table')!,cells=Array.from(table.querySelectorAll<HTMLTableCellElement>('td,th')).filter(item=>item.closest('table')===table);
   const caret=cellCaret(view,cell,event.key==='ArrowUp');if(!caret)return;
   if(rowDelete){if(deleteCaretRow(view,cell)){event.preventDefault();event.stopPropagation();}return;}
   if(enter&&(event.ctrlKey||event.metaKey)){if(insertCaretRow?.(view,cell)){event.preventDefault();event.stopPropagation();}return;}
   if(event.key==='Enter'&&(!enter||(cell.parentElement as HTMLTableRowElement).rowIndex+cell.rowSpan!==table.rows.length))return;
   const forward=event.key==='ArrowRight';
   if(!enter&&(event.key==='ArrowUp'?cell.parentElement!==table.rows[0]||!caret.top:
    forward?cell!==lastTableCell(table)||!caret.end:cell!==cells[0]||!caret.start))return;
   const position=wrapper.classList.contains('cm-table-widget')?view.posAtDOM(wrapper):Number(wrapper.dataset.pfTableFrom);
   let source=findEditableTableSources(view.state).find(item=>item.from<=position&&position<=item.to);
   if(!source)return;
   if(wrapper.classList.contains('cm-table-widget')){
    // GFM may parse a plain trailing paragraph as a row that the host does not render.
    const end=view.state.doc.lineAt(source.from).number+table.rows.length;
    if(end>view.state.doc.lines)return;
    const to=view.state.doc.line(end).to;
    source={...source,to,source:view.state.sliceDoc(source.from,to)};
   }
   if(event.key==='Backspace'){
    const plan=emptyTableDeletion(view,source);if(!plan)return;
    event.preventDefault();event.stopPropagation();view.dispatch(plan);view.focus();return;
   }
   const goal=event.key==='ArrowUp'?requireGoalXStore(view).read()??caret.x-view.contentDOM.getBoundingClientRect().left:undefined;
   let plan:TransactionSpec;
   if(forward||enter)plan=blockExitPlan(view.state,source.to,source.container?.prefixes[0]??'');
   else {
    if(!source.container&&!view.state.sliceDoc(0,source.from).trim())plan=enterVirtualTail(view.state,{side:'before',returnTo:source.from,goalColumn:goal});
    else {
     if(source.from===0){event.preventDefault();event.stopPropagation();return;}
     const head=normalizeParagraphSelectionEndpoint(view.state,source.from-1,-1);
     plan={selection:EditorSelection.create([EditorSelection.cursor(head,-1,undefined,goal)]),annotations:selectionModeAnnotation.of('normal'),userEvent:event.key==='ArrowUp'?'move.line':'move.character',scrollIntoView:true};
    }
   }
   const selection=plan.selection as EditorSelection,head=selection.main.head;
   const adjacent=findEditableTableSources(view.state).find(item=>item.from<=head&&head<=item.to&&item.from!==source.from);
   if(adjacent){if(!enterFollowingTable(view,adjacent.from,forward||enter))return;}
   else {view.dispatch(plan);view.focus();}
   event.preventDefault();event.stopPropagation();if(goal!==undefined)requireGoalXStore(view).write(goal);
  };
  view.dom.addEventListener('keydown',capture,true);
  const releaseScope=options.registerKeyScope?.(view,event=>{
   if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey)capture(event);
  });
  return {update(update){
   for(const transaction of update.transactions){
    const effect=transaction.effects.find(effect=>effect.is(emptyTableHistory));
    if(!effect||!effect.value.restore&&!transaction.isUserEvent('redo'))continue;
    // History restores parent source selection; the cell editor needs a separate DOM handoff.
    queueMicrotask(()=>{
     if(destroyed||view.state.doc!==transaction.state.doc||!options.isActive(view)||options.isActiveView?.(view)===false)return;
     if(effect.value.restore)enterFollowingTable(view,effect.value.from);
     else view.focus();
    });
   }
  },destroy(){destroyed=true;releaseScope?.();view.dom.removeEventListener('keydown',capture,true);}};
 })];
}
