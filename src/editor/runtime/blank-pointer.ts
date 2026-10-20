import {type Extension} from '@codemirror/state';
import {ViewPlugin,type EditorView} from '@codemirror/view';
import {getParagraphProjectionState} from '../paragraph/projection.js';
import {normalizeParagraphSelectionEndpoint} from '../paragraph/selection-protection.js';
import {createRenderedSourceClickExtension,handoffRenderedSourceGesture} from './rendered-source-click.js';
import {compositionStateField} from './input-state.js';
import {isVirtualEdgeActive,setVirtualTail,enterVirtualTail,virtualTailState,setEdgePointer} from './virtual-tail.js';
import {clearTableFocus,requestTableFocus,tableActivationDestination} from '../table/focus-handoff.js';

/** Immutable spacing and outside EOF share the ordinary source-pointer gesture. */
export function createBlankPointerExtension(isActive:(view:EditorView)=>boolean):Extension {
	return [createRenderedSourceClickExtension(),ViewPlugin.define(view=>{
		let forwarding=false;
		let pressed=false;
		let pointerSide:'before'|'after'|null=null;
		const active=()=>isActive(view)&&!view.state.readOnly;
		const down=(event:MouseEvent)=>{
			if(forwarding||event.defaultPrevented||!active()||event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.detail>1||view.composing||view.state.field(compositionStateField,false))return;
			const target=event.target as Element;
			if(target.closest('.cm-editor')!==view.dom||target.closest('button,input,select,textarea,a,table,[role="button"]'))return;
			const editable=target.closest('[contenteditable="true"]');
			if(editable&&editable!==view.contentDOM)return;
			pressed=true;
			const tail=view.contentDOM.querySelector<HTMLElement>('.paraflow-virtual-tail');
			const first=view.contentDOM.querySelector<HTMLElement>('.paraflow-virtual-head');
			const firstBox=first?.getBoundingClientRect();
			const before=!!target.closest('.paraflow-virtual-head')||(target===view.contentDOM||target===view.scrollDOM)&&!!firstBox&&event.clientY<=firstBox.bottom+2&&event.clientY>=view.scrollDOM.getBoundingClientRect().top;
			const exactTail=!!target.closest('.paraflow-virtual-tail');
			let outside=exactTail;
			if(tail&&(target===view.contentDOM||target===view.scrollDOM)){
				const row=tail.getBoundingClientRect(),content=view.contentDOM.getBoundingClientRect(),scroll=view.scrollDOM.getBoundingClientRect();
				outside=event.clientY>=row.top&&event.clientY<scroll.top+view.scrollDOM.clientHeight&&
					event.clientX>=Math.max(content.left,scroll.left)&&event.clientX<Math.min(content.right,scroll.left+view.scrollDOM.clientWidth);
			}
			const gap=target.closest<HTMLElement>('.paraflow-paragraph-gap-head,.paraflow-paragraph-folded-row,.paraflow-block-boundary-gap');
			let position:number|null=null;
			if(before)position=0;
			else if(outside)position=view.state.doc.length;
			else if(gap&&view.contentDOM.contains(gap)){
				const projection=getParagraphProjectionState(view.state);
				if(projection){
					const at=view.posAtDOM(gap),box=gap.getBoundingClientRect(),bias=event.clientY<box.top+box.height/2?-1:1;
					const range=projection.rangeIndex.gaps.find(item=>item.from<=at&&at<item.to);
					const synthetic=gap.classList.contains('paraflow-block-boundary-gap');
					if(range)position=bias<0&&range.from===0&&!projection.rangeIndex.editableAnchors.includes(0)?range.to:bias<0?range.from:range.to;
					else if(synthetic)position=bias<0?at-1:at;
					if(position!==null)position=normalizeParagraphSelectionEndpoint(view.state,position,bias,event.shiftKey?'range':'cursor');
				}
			}
			if(position===null){if(isVirtualEdgeActive(view.state))view.dispatch({effects:setVirtualTail.of(null)});return;}
			const edge=(outside||before)?enterVirtualTail(view.state,{side:before?'before':'after',anchor:event.shiftKey?view.state.selection.main.anchor:undefined}):null;
			if(edge?.selection)position='anchor' in edge.selection?edge.selection.anchor:edge.selection.main.head;
			const effects=edge?.effects??[setVirtualTail.of(null)];
			const table=!event.shiftKey&&!edge?tableActivationDestination(view,position):null;
			forwarding=true;
			try{
				handoffRenderedSourceGesture(view,event,position,active,Array.isArray(effects)?effects:[effects],table?()=>{clearTableFocus(view);view.focus();}:undefined);
				if(table){
					const transaction=view.state.update({selection:{anchor:table.position}});
					requestTableFocus(view,transaction,table.from,table.bookmark,true);
					view.dispatch(transaction);
				}
			}finally{forwarding=false;}
		};
		// Native CM drag has the same source offset at the final character and at
		// an outside row when there is no terminal LF. Preserve the actual hit.
		const move=(event:MouseEvent)=>{
			if(!pressed||event.buttons!==1||!active()||view.state.selection.ranges.length!==1)return;
			const tail=view.contentDOM.querySelector<HTMLElement>('.paraflow-virtual-tail')?.getBoundingClientRect();
			const first=view.contentDOM.querySelector<HTMLElement>('.paraflow-virtual-head')?.getBoundingClientRect();
			const side=tail&&event.clientY>=tail.top?'after':first&&event.clientY<=first.bottom?'before':null;
			if(side===pointerSide)return;
			pointerSide=side;
			const current=view.state.field(virtualTailState);
			if(side){const entry=enterVirtualTail(view.state,{side,anchor:view.state.selection.main.anchor});view.dispatch(entry,{effects:setEdgePointer.of(side)});}
			else view.dispatch({effects:[setEdgePointer.of(null),...(current&&!view.state.selection.main.empty?[setVirtualTail.of(null)]:[])]});
		};
		const release=()=>{
			if(!pressed)return;
			pressed=false;
			if(pointerSide===null)return;
			pointerSide=null;
			view.dispatch({effects:setEdgePointer.of(null)});
		};
		view.dom.addEventListener('mousedown',down,true);
		view.dom.ownerDocument.addEventListener('mousemove',move,true);
		view.dom.ownerDocument.addEventListener('mouseup',release);
		view.dom.ownerDocument.defaultView!.addEventListener('blur',release);
		return {destroy(){view.dom.removeEventListener('mousedown',down,true);view.dom.ownerDocument.removeEventListener('mousemove',move,true);view.dom.ownerDocument.removeEventListener('mouseup',release);view.dom.ownerDocument.defaultView!.removeEventListener('blur',release);}};
	})];
}
