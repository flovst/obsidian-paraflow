import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { compositionStateField, excludedSelectionModeForTransaction } from '../runtime/input-state.js';
import { blockExitPlan } from '../block-exit.js';
import { findEditableTableSources } from './edit-session.js';
import type { TableEditingOptions } from './editing-types.js';
import {enterFollowingTable} from './keyboard-entry';
import {enterVirtualTail} from '../runtime/virtual-tail';
import {requireGoalXStore} from '../runtime/navigation-core';
import {tableExitSelection} from './vertical-exit';

/** Native pipe cells synchronously dispatch an unannotated parent selection on final Down. */
export function createNativeTableKeyboardExit(options: TableEditingOptions): Extension {
	interface Exit { active: boolean; event: KeyboardEvent; from: number; to: number; selection?:EditorSelection }
	const pending = new WeakMap<EditorState, Exit>();
	return [EditorState.transactionFilter.of(transaction => {
		const exit = pending.get(transaction.startState);
		if (!exit?.active || exit.event.eventPhase === Event.NONE) return transaction;
		if(exit.to===transaction.startState.doc.length&&transaction.docChanged&&transaction.selection&&transaction.newSelection.main.empty&&transaction.newSelection.main.head===exit.to+1) {
			let onlyExitLine=false,count=0;
			transaction.changes.iterChanges((from,to,_fromB,_toB,text)=>{count++;onlyExitLine=from===exit.to&&to===from&&text.toString()==='\n';});
			// The host's addNewLine is a separate transaction after its cell commit.
			// Replace only that proven navigation append, retaining all committed cell text.
			if(count===1&&onlyExitLine){exit.active=false;return enterVirtualTail(transaction.startState,{goalColumn:transaction.newSelection.main.goalColumn});}
		}
		if (transaction.docChanged) {
			let inside = true;
			transaction.changes.iterChangedRanges((from, to) => { if (from < exit.from || to > exit.to) inside = false; });
			if (!inside) { exit.active = false; return transaction; }
			exit.from = transaction.changes.mapPos(exit.from, -1);
			exit.to = transaction.changes.mapPos(exit.to, -1);
			exit.selection=exit.selection?.map(transaction.changes);
		}
		pending.set(transaction.state, exit);
		const selection = transaction.newSelection;
		if (!transaction.selection || selection.ranges.length !== 1 || !selection.main.empty ||
			selection.main.head !== exit.to + 1 || excludedSelectionModeForTransaction(transaction)) return transaction;
		exit.active = false;
		const plan=blockExitPlan(transaction.state,exit.to,'',selection.main.goalColumn);
		return [transaction, {...plan,...(exit.selection?{selection:exit.selection}:{}),sequential:true}];
	}), ViewPlugin.define(view => {
		let current: Exit | null = null;
		const capture = (event: KeyboardEvent): void => {
			if (current) current.active = false;
			if (event.key !== 'ArrowDown' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing ||
				view.composing || view.state.field(compositionStateField, false) || !options.isActive(view) || options.isActiveView?.(view) === false) return;
			const target = event.target as HTMLElement;
			const cell = target.closest<HTMLTableCellElement>('.cm-table-widget td,.cm-table-widget th');
			const table = cell?.closest('table');
			if (!cell || !table || cell.parentElement !== table.rows[table.rows.length - 1]) return;
			const position = view.posAtDOM(cell.closest('.cm-table-widget')!);
			const source = findEditableTableSources(view.state).find(item => item.kind === 'markdown' && !item.container && item.from <= position && position <= item.to);
			if (!source) return;
			// Native rows exclude the plain-text continuation that GFM admits as another table row.
			// Each rendered row has one source line, plus the unrendered Markdown separator.
			const endLine = view.state.doc.lineAt(source.from).number + table.rows.length;
			if (endLine > view.state.doc.lineAt(source.to).number) return;
			const to = view.state.doc.line(endLine).to;
			const content=cell.querySelector<HTMLElement>('.cm-content'),nested=content?EditorView.findFromDOM(content):null;
			const nativeSelection=cell.ownerDocument.getSelection();
			const caret=nested&&nested!==view?nested.coordsAtPos(nested.state.selection.main.head):
				nativeSelection?.isCollapsed&&nativeSelection.rangeCount&&cell.contains(nativeSelection.focusNode)?Array.from(nativeSelection.getRangeAt(0).getClientRects()).find(box=>box.height>0):null;
			const goal=caret?requireGoalXStore(view).read()??caret.left-view.contentDOM.getBoundingClientRect().left:undefined;
			const plan=blockExitPlan(view.state,to,'',goal);
			const head=(plan.selection as EditorSelection).main.head;
			const next=findEditableTableSources(view.state).find(target=>target.from<=head&&head<=target.to&&target.from>to);
			if(next&&enterFollowingTable(view,next.from,true,goal)) {event.preventDefault();event.stopPropagation();return;}
			// Trusted key events can checkpoint microtasks between listeners.
			// The event phase proves its dispatch is still in progress.
			const exit: Exit = { active: true, event, from: source.from, to,
				selection:goal!==undefined&&head>to?tableExitSelection(view,head,goal,true):undefined };
			current = exit;
			pending.set(view.state, exit);
		};
		view.dom.addEventListener('keydown', capture, true);
		return { destroy() { if (current) current.active = false; view.dom.removeEventListener('keydown', capture, true); } };
	})];
}
