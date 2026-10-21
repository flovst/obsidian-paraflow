import { Annotation, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { classifyCurrentSelectionMode, requireCompositionState, selectionModeAnnotation } from '../runtime/input-state.js';
import { discoverMath, type MathExpression } from './syntax.js';
import { projectMathSource } from './source.js';
import { adjacentBlock, blockContinuationPrefix, planBlockBodyKey } from '../runtime/block-body.js';
import { completionOwnsTab } from '../runtime/tab-ownership.js';
import { retainMathSource } from './candidate-state.js';

/** A semantic whole-block edit has already validated its math owner. */
export const mathBlockEdit = Annotation.define<boolean>();

/** TeX whitespace belongs to math, including leading tabs and empty body rows. */
export function insertMathTab(view: EditorView): boolean {
	const state = view.state, head = state.selection.main.head;
	if (state.readOnly || view.composing || requireCompositionState(state) ||
		classifyCurrentSelectionMode(state) !== 'caret' || state.selection.ranges.length !== 1 ||
		!state.selection.main.empty || completionOwnsTab(view)) return false;
	const math = discoverMath(state).find(math => math.contentFrom <= head && head <= math.contentTo);
	if (!math) return false;
	const source = projectMathSource(state, math);
	const lines = math.display ? source.bodyLines : source.lines;
	if (!lines.some(line => line.from <= head && head <= line.to)) return false;
	view.dispatch({ changes: { from: head, insert: '\t' }, selection: { anchor: head + 1 },
		effects: retainMathSource.of(math),
		userEvent: 'input.math-tab', scrollIntoView: true,
		annotations: [mathBlockEdit.of(true), isolateHistory.of('full'), selectionModeAnnotation.of('normal')] });
	return true;
}

export function editMathBody(view: EditorView, key: 'Enter' | 'Shift-Enter' | 'Backspace' | 'Delete',
	isActive: (state: EditorState) => boolean, active: MathExpression | null = null): boolean {
	const state = view.state, head = state.selection.main.head;
	const math = discoverMath(state).find(math => math.display && math.from <= head && head <= math.to);
	if (!math) return false;
	const retained = active?.display === true && active.from === math.from && active.to === math.to;
	if (!editingState(view, isActive, retained)) return false;
	const body = projectMathSource(state, math);
	if (key === 'Shift-Enter') {
		if (!body.bodyLines.some(line => line.from <= head && head <= line.to)) return false;
		const insert = '\n' + blockContinuationPrefix(state, math.from);
		view.dispatch({ changes: { from: head, insert }, selection: { anchor: head + insert.length },
			userEvent: 'input.math-line', scrollIntoView: true,
			annotations: [mathBlockEdit.of(true), isolateHistory.of('full'), selectionModeAnnotation.of('normal')] });
		return true;
	}
	const plan = planBlockBodyKey(state, key, body.bodyLines, blockContinuationPrefix(state, math.from));
	if (!plan) return false;
	view.dispatch(plan, { annotations: mathBlockEdit.of(true) });
	return true;
}

function editingState(view: EditorView, isActive: (state: EditorState) => boolean, retainedSource = false): boolean {
	const mode = classifyCurrentSelectionMode(view.state);
	return isActive(view.state) && !view.state.readOnly && !view.composing && !requireCompositionState(view.state) &&
		(mode === 'caret' || mode === 'unknown' && retainedSource) && view.state.selection.ranges.length === 1 && view.state.selection.main.empty;
}

export function deleteEmptyMath(view: EditorView, isActive: (state: EditorState) => boolean, active: MathExpression | null = null): boolean {
	const state=view.state, caret=state.selection.main;
	const math=discoverMath(state).find(math=>math.display && math.from<=caret.head && caret.head<=math.to);
	if (!math) return false;
	const retained = active?.display === true && active.from === math.from && active.to === math.to;
	if (!editingState(view,isActive,retained)) return false;
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
