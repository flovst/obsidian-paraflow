import type {Extension,Transaction} from '@codemirror/state';
import {EditorView,ViewPlugin} from '@codemirror/view';
import type {TableEditingOptions} from './editing-types';
import {isVirtualTailActive} from '../runtime/virtual-tail';

/** Native table receiveSelection treats EOF as an inclusive cell boundary, including Undo. */
interface NativeTableSelectionOwner {containerEl:HTMLElement;end:number;receiveSelection:(transaction:Transaction)=>void;}
export function createNativeTableTailOwner(options:Pick<TableEditingOptions,'isActive'|'isActiveView'>):Extension {
	return ViewPlugin.define(view=>{
		const originals=new Map<NativeTableSelectionOwner,{method:NativeTableSelectionOwner['receiveSelection'];wrapper:NativeTableSelectionOwner['receiveSelection'];own:boolean}>();
		const release=(table:NativeTableSelectionOwner)=>{const original=originals.get(table)!;if(table.receiveSelection===original.wrapper){if(original.own)table.receiveSelection=original.method;else Reflect.deleteProperty(table,'receiveSelection');}originals.delete(table);};
		const bind=()=>{
			const current=new Set<NativeTableSelectionOwner>();
			for(const value of view.state.facet(EditorView.decorations)){
				if(typeof value==='function')continue;
				for(let cursor=value.iter();cursor.value;cursor.next()){
					const widget=(cursor.value.spec as {widget?:unknown}).widget;
					if(!widget||typeof widget!=='object'||!('receiveSelection' in widget)||typeof widget.receiveSelection!=='function'||!('containerEl' in widget)||!(widget.containerEl instanceof view.dom.ownerDocument.defaultView!.HTMLElement)||!widget.containerEl.classList.contains('cm-table-widget')||!('end' in widget)||typeof widget.end!=='number')continue;
					const table=widget as NativeTableSelectionOwner;current.add(table);if(originals.has(table))continue;
					const method=table.receiveSelection;
					const wrapper=function(this:NativeTableSelectionOwner,transaction:Transaction){
						const selection=transaction.newSelection;
						if(options.isActive(view)&&options.isActiveView?.(view)!==false&&isVirtualTailActive(transaction.state)&&selection.main.empty&&selection.main.head===transaction.newDoc.length&&this.end===transaction.newDoc.length)return;
						method.call(this,transaction);
					};
					originals.set(table,{method,wrapper,own:Object.prototype.hasOwnProperty.call(table,'receiveSelection')});table.receiveSelection=wrapper;
				}
			}
			for(const table of originals.keys())if(!current.has(table))release(table);
		};
		bind();return {update:bind,destroy(){for(const table of originals.keys())release(table);}};
	});
}
