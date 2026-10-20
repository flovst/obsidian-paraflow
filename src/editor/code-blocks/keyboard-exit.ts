import {EditorSelection,type Extension} from '@codemirror/state';
import {ViewPlugin, type EditorView} from '@codemirror/view';
import {blockExitPlan,codeExitPrefix} from '../block-exit';
import {compositionStateField} from '../runtime/input-state';
import {discoverCodeBlocks} from './model';
import {findEditableTableSources} from '../table/edit-session';
import {enterFollowingTable} from '../table/keyboard-entry';
import {codeBodyStart} from './editable-boundaries';
import {isVirtualTailActive} from '../runtime/virtual-tail';
import {createGoalXStoreExtension,requireGoalXStore} from '../runtime/navigation-core';
import {alignBlockExitSelection} from '../runtime/vertical-exit';

export function createCodeKeyboardExit(isActive:(view:EditorView)=>boolean):Extension {
	return [createGoalXStoreExtension(),ViewPlugin.define(view=>{
		const capture=(event:KeyboardEvent)=>{
			if(!['ArrowDown','ArrowRight'].includes(event.key)||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey||event.isComposing||view.composing||isVirtualTailActive(view.state)||view.state.readOnly||
				view.state.field(compositionStateField,false)||!isActive(view)||
				(event.target as Element).closest('.cm-content')!==view.contentDOM)return;
			const selection=view.state.selection;
			if(selection.ranges.length!==1||!selection.main.empty)return;
			const head=selection.main.head;
			const block=discoverCodeBlocks(view.state).find(block=>block.closed&&!block.indented&&
				(block.lines.length ? head>=block.lines.at(-1)!.from&&head<=block.lines.at(-1)!.to : head===codeBodyStart(view.state,block)));
			if(!block)return;
			if(event.key==='ArrowRight'&&head!==(block.lines.at(-1)?.to??codeBodyStart(view.state,block)))return;
			const caret=view.coordsAtPos(head,selection.main.assoc<0?-1:1),end=view.coordsAtPos(block.lines.at(-1)?.to ?? codeBodyStart(view.state,block),-1);
			if(!caret||!end||(caret.top+caret.bottom)/2<end.top)return;
			const store=requireGoalXStore(view);
			const goal=store.read()??selection.main.goalColumn??caret.left-view.contentDOM.getBoundingClientRect().left;
			const plan=blockExitPlan(view.state,block.to,codeExitPrefix(view.state,block.to),event.key==='ArrowDown'?goal:undefined);
			if(view.state.readOnly&&plan.changes)return;
			const target=(plan.selection as EditorSelection).main.head;
			const table=findEditableTableSources(view.state).find(table=>table.from<=target&&target<=table.to);
			if(table) {
				if(!enterFollowingTable(view,table.from,true,event.key==='ArrowDown'?goal:undefined))return;
			} else {
				view.dispatch(event.key==='ArrowDown'&&!plan.effects?{...plan,selection:alignBlockExitSelection(view,target,goal,true)}:plan);
			}
			store.write(event.key==='ArrowDown'?goal:null);
			event.preventDefault();event.stopPropagation();
		};
		view.dom.addEventListener('keydown',capture,true);
		return {destroy(){view.dom.removeEventListener('keydown',capture,true);}};
	})];
}
