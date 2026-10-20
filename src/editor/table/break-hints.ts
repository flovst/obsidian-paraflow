import type {EditorView} from '@codemirror/view';
import type {Text} from '@codemirror/state';
import {findEditableTableSources} from './edit-session.js';
import {markdownCellContents} from './toolbar-source.js';

/** Paint-only hints leave native cell DOM, HTML source maps and clipboard content untouched. */
export class TableBreakHints {
 private readonly layer:HTMLElement;
 private readonly nativeCells=new WeakMap<HTMLTableElement,{doc:Text;cells:readonly (readonly string[])[]}>();
 private readonly terminalBodies=new Set<HTMLElement>();
 constructor(private readonly view:EditorView){
  this.layer=view.dom.ownerDocument.createElement('div');
  this.layer.className='paraflow-table-break-hints';this.layer.setAttribute('aria-hidden','true');this.layer.setAttribute('contenteditable','false');
  view.dom.ownerDocument.body.append(this.layer);
 }
 update(enabled:boolean,layoutEnabled=enabled):void {
  const terminalBodies=new Set<HTMLElement>();
  if(layoutEnabled)for(const br of this.view.contentDOM.querySelectorAll<HTMLElement>('.cm-table-widget table.table-editor .table-cell-wrapper br')){
   const body=br.closest<HTMLElement>('.table-cell-wrapper')!;
   if(body.querySelector('.cm-editor')||this.nativeEmptyCell(br))continue;
   let tail:Node|null=br.nextSibling;
   while(tail?.nodeType===3&&/^[\t\r\n ]*$/u.test(tail.textContent!))tail=tail.nextSibling;
   if(br.parentElement===body&&!tail)terminalBodies.add(body);
  }
  for(const body of this.terminalBodies)if(!terminalBodies.has(body))body.classList.remove('paraflow-table-terminal-break');
  for(const body of terminalBodies)body.classList.add('paraflow-table-terminal-break');
  this.terminalBodies.clear();for(const body of terminalBodies)this.terminalBodies.add(body);
  this.layer.replaceChildren();this.layer.hidden=!enabled;if(!enabled)return;
  const viewport=this.view.scrollDOM.getBoundingClientRect();
  this.layer.style.left=`${viewport.left}px`;this.layer.style.top=`${viewport.top}px`;
  this.layer.style.width=`${viewport.width}px`;this.layer.style.height=`${viewport.height}px`;
  for(const br of this.view.contentDOM.querySelectorAll<HTMLElement>(':is(.cm-table-widget,.paraflow-html-table-editor, .cm-html-embed table) :is(td,th) br:not([data-paraflow-cell-placeholder])')){
   // Nested CM owns both source hints and visual breaks, including its caret carriers.
   if(br.closest('.cm-editor')!==this.view.dom||this.nativeEmptyCell(br))continue;
   const box=br.getBoundingClientRect(),cell=br.closest('td,th')!.getBoundingClientRect();
   if(!box.height||box.bottom<=viewport.top||box.top>=viewport.bottom||box.left>=viewport.right)continue;
   let left=viewport.left,right=Math.min(cell.right,viewport.right);
   const win=br.ownerDocument.defaultView!;
   for(let parent=br.parentElement;parent&&parent!==this.view.scrollDOM;parent=parent.parentElement){
    if(!/^(?:auto|scroll|hidden|clip|overlay)$/u.test(win.getComputedStyle(parent).overflowX))continue;
    const clip=parent.getBoundingClientRect();left=Math.max(left,clip.left);right=Math.min(right,clip.right);
   }
   if(right<=left||box.left>=right)continue;
   const hint=br.ownerDocument.createElement('span');hint.className='paraflow-table-break-hint';hint.textContent='<br>';
   if(br.closest('.paraflow-html-table-editor'))hint.classList.add('paraflow-table-break-hint-rich');
   const font=br.ownerDocument.defaultView!.getComputedStyle(br);
   hint.style.color=font.getPropertyValue('--paraflow-source-color')||font.getPropertyValue('--text-faint');
   for(const property of ['font-family','font-size','font-weight','font-style'])hint.style.setProperty(property,font.getPropertyValue(property));
   hint.style.left=`${box.left-viewport.left}px`;hint.style.top=`${box.top-viewport.top}px`;
   hint.style.lineHeight=`${box.height}px`;hint.style.maxWidth=`${Math.max(0,right-box.left)}px`;
   hint.style.clipPath=`inset(0 0 0 ${Math.max(0,left-box.left)}px)`;
   this.layer.append(hint);
  }
 }
 private nativeEmptyCell(br:HTMLElement):boolean {
  const cell=br.closest<HTMLTableCellElement>('td,th')!,table=cell.closest('table')!;
  if(!table.matches('.cm-table-widget table.table-editor'))return false;
  let cached=this.nativeCells.get(table);
  if(cached?.doc!==this.view.state.doc){
   const position=this.view.posAtDOM(table);
   const source=findEditableTableSources(this.view.state).find(target=>target.kind==='markdown'&&target.from<=position&&position<=target.to);
   if(!source)return false;
   cached={doc:this.view.state.doc,cells:markdownCellContents(source.source)};this.nativeCells.set(table,cached);
  }
  return !(cached.cells[(cell.parentElement as HTMLTableRowElement).rowIndex]?.[cell.cellIndex]??'').trim();
 }
 destroy():void {for(const body of this.terminalBodies)body.classList.remove('paraflow-table-terminal-break');this.terminalBodies.clear();this.layer.remove();}
}
