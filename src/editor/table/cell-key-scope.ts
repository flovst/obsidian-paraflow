import type {EditorView} from '@codemirror/view';
import type {Scope} from 'obsidian';

/** A leaf-local child scope owns table shortcuts only while a cell has focus. */
export function bindTableCellScope(view:EditorView,resolve:()=>{owner:{scope:Scope|null};scope:Scope}|null,handle:(event:KeyboardEvent)=>void):()=>void {
	let active:{owner:{scope:Scope|null};scope:Scope;previous:Scope|null;release:()=>void}|null=null,destroyed=false;
	const release=()=>{if(!active)return;active.release();if(active.owner.scope===active.scope)active.owner.scope=active.previous;active=null;};
	const refresh=()=>{
		if(destroyed)return;
		const element=view.dom.ownerDocument.activeElement;
		if(!element||!view.dom.contains(element)||!element.closest('.cm-table-widget td,.cm-table-widget th,.paraflow-html-table-editor td,.paraflow-html-table-editor th')){release();return;}
		if(active)return;const binding=resolve();if(!binding)return;
		const {owner,scope}=binding,previous=owner.scope;
		// A null/null registration can return undefined to delegate every unowned key.
		const registration=scope.register(null,null,event=>{handle(event);return event.defaultPrevented?false:undefined;});
		active={owner,scope,previous,release:()=>scope.unregister(registration)};owner.scope=scope;
	};
	const defer=()=>queueMicrotask(refresh);
	view.dom.addEventListener('focusin',refresh,true);view.dom.addEventListener('focusout',defer,true);refresh();
	return()=>{destroyed=true;view.dom.removeEventListener('focusin',refresh,true);view.dom.removeEventListener('focusout',defer,true);release();};
}
