import { Annotation, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { classifyCurrentSelectionMode, requireCompositionState, selectionModeAnnotation } from '../runtime/input-state.js';
import { discoverMath } from './syntax.js';
import { projectMathSource } from './source.js';
import { adjacentBlock, blockContinuationPrefix, planBlockBodyKey } from '../runtime/block-body.js';

/** A semantic whole-block edit has already validated its math owner. */
export const mathBlockEdit = Annotation.define<boolean>();

export function editMathBody(view: EditorView, key: 'Enter' | 'Backspace' | 'Delete', isActive: (state: EditorState) => boolean): boolean {
	if (!editingState(view, isActive)) return false;
	const state = view.state, head = state.selection.main.head;
	const math = discoverMath(state).find(math => math.display && math.from <= head && head <= math.to);
	if (!math) return false;
	const body = projectMathSource(state, math);
	const plan = planBlockBodyKey(state, key, body.bodyLines, blockContinuationPrefix(state, math.from));
	if (!plan) return false;
	view.dispatch(plan, { annotations: mathBlockEdit.of(true) });
	return true;
}

function editingState(view: EditorView, isActive: (state: EditorState) => boolean): boolean {
	return isActive(view.state) && !view.state.readOnly && !view.composing && !requireCompositionState(view.state) &&
		classifyCurrentSelectionMode(view.state) === 'caret' && view.state.selection.ranges.length === 1 && view.state.selection.main.empty;
}

export function deleteEmptyMath(view: EditorView, isActive: (state: EditorState) => boolean): boolean {
	const state=view.state, caret=state.selection.main;
	if (!editingState(view,isActive)) return false;
	const math=discoverMath(state).find(math=>math.display && math.from<=caret.head && caret.head<=math.to);
	if (!math) return false;
	const body=projectMathSource(state,math);
	if (caret.head !== body.from || body.source.replace(/\n/gu,'') !== '') return false;
	view.dispatch({changes:{from:math.from,to:math.to,insert:''},selection:{anchor:math.from},
		userEvent:'delete.math-empty',annotations:[mathBlockEdit.of(true),isolateHistory.of('full'),selectionModeAnnotation.of('normal')]});
	return true;
}

/** Typora uses asymmetric block deletion: forward removes math, backward joins into it. */
export function deleteAdjacentMath(view: EditorView, forward: boolean, isActive: (state: EditorState) => boolean): boolean {
	if (!editingState(view,isActive)) return false;
	const state=view.state,head=state.selection.main.head;
	const adjacent=adjacentBlock(state,discoverMath(state).filter(math=>math.display),forward);
	if(!adjacent)return false;
	const {block:math,current,next}=adjacent;
	const annotations=[mathBlockEdit.of(true),isolateHistory.of('full'),selectionModeAnnotation.of('normal')];
	if(forward){
		view.dispatch({changes:{from:head,to:next?.from??math.to},selection:{anchor:head},userEvent:'delete.math-forward',annotations});
	}else{
		const body=projectMathSource(state,math);
		view.dispatch({changes:[{from:body.to,insert:state.sliceDoc(current.from,current.to)},{from:math.to,to:current.to}],
			selection:{anchor:body.from},userEvent:'delete.math-backward',annotations});
	}
	return true;
}
