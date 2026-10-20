import type {EditorView} from '@codemirror/view';
import {getParagraphProjectionState} from '../paragraph/projection';
import {requireCompositionState} from '../runtime/input-state';
import {requireGoalXStore} from '../runtime/navigation-core';
import type {TableEditSession} from './edit-session';
import {blockExitPlan} from '../block-exit';
import {enterFollowingTable} from './keyboard-entry';
import {findEditableTableSources} from './edit-session';
import {EditorSelection} from '@codemirror/state';
import {tableExitSelection} from './vertical-exit';

/** Contenteditable's default Down can flow sideways into the next cell. */
export function exitHtmlTableDown(view:EditorView,session:TableEditSession,event:KeyboardEvent):boolean {
	if(event.key!=='ArrowDown'||event.shiftKey||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||view.composing||
		!view.dom.classList.contains('paraflow-paragraph-editing-active'))return false;
	if(!getParagraphProjectionState(view.state)?.authority.complete||requireCompositionState(view.state))return false;
	const cell=(event.target as Element).closest<HTMLTableCellElement>('td,th');
	if(!cell||Number(cell.dataset.pfRow)+cell.rowSpan!==session.table.rows)return false;
	const selection=cell.ownerDocument.getSelection();
	if(!selection?.isCollapsed||!selection.rangeCount||!cell.contains(selection.focusNode))return false;
	const caret=selection.getRangeAt(0),caretBox=Array.from(caret.getClientRects()).filter(box=>box.height>0).at(-1);
	const content=cell.ownerDocument.createRange();content.selectNodeContents(cell);
	const boxes=Array.from(content.getClientRects()).filter(box=>box.height>0);
	const last=boxes.reduce<DOMRect|null>((bottom,box)=>!bottom||box.bottom>bottom.bottom?box:bottom,null);
	if(last&&(!caretBox||caretBox.top+caretBox.height/2<last.top))return false;
	const store=requireGoalXStore(view),left=view.contentDOM.getBoundingClientRect().left;
	const goal=store.read()??(caretBox?.left??cell.getBoundingClientRect().left)-left;
	const plan=blockExitPlan(view.state,session.target.to,session.target.container?.prefixes[0]??'',goal);
	const head=(plan.selection as EditorSelection).main.head;
	const next=findEditableTableSources(view.state).find(target=>target.from>session.target.to&&target.from<=head&&head<=target.to);
	if(next) {if(!enterFollowingTable(view,next.from,true,goal))return false;}
	else {
		view.dispatch(plan.effects?plan:{...plan,selection:tableExitSelection(view,head,goal,true)});view.focus();
	}
	event.preventDefault();event.stopPropagation();
	store.write(goal);return true;
}
