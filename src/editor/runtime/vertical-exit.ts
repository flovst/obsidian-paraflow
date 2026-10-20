import {EditorSelection} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {createVisualNavigationAdapter} from './navigation-core';
import {normalizeParagraphSelectionEndpoint} from '../paragraph/selection-protection';
import {renderedSourceClickPosition} from './rendered-source-click';

/** The block boundary chooses the visual row; the remembered X chooses its caret. */
export function alignBlockExitSelection(view:EditorView,head:number,goal:number,forward:boolean):EditorSelection {
 const bias=forward?1:-1;
 for(const read of view.state.facet(EditorView.atomicRanges)) {
  read(view).between(head,head,(from,to)=>{
   if(forward?from<=head&&head<to:from<head&&head<=to)head=forward?to:from;
  });
 }
 const coordinates=view.coordsAtPos(head,bias),node=view.domAtPos(head).node;
 const line=(node.nodeType===1?node as Element:node.parentElement)?.closest<HTMLElement>('.cm-line');
 // CM's height map can hit the preceding block replacement beside a projected heading.
 const hit=coordinates&&line?renderedSourceClickPosition({clientX:view.contentDOM.getBoundingClientRect().left+goal,
  clientY:(coordinates.top+coordinates.bottom)/2},line,(node,offset)=>view.posAtDOM(node,offset)):null;
 const point=hit===null?createVisualNavigationAdapter(view).alignGoalOnVisualLine!({position:head,assoc:bias},goal):{position:hit,assoc:bias};
 const position=normalizeParagraphSelectionEndpoint(view.state,point.position,bias);
 return EditorSelection.create([EditorSelection.cursor(position,position===point.position?point.assoc:bias,undefined,goal)]);
}
