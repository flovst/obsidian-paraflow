import { EditorSelection, type EditorState, type Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { classifyCurrentSelectionMode, requireCompositionState } from '../runtime/input-state.js';
import { createVisualNavigationAdapter, requireGoalXStore } from '../runtime/navigation-core.js';
import { discoverMath } from './syntax.js';
import { projectMathSource, clampMathBody } from './source.js';
import { getParagraphProjectionState } from '../paragraph/projection.js';
import { enterVirtualTail, isVirtualTailActive } from '../runtime/virtual-tail.js';

/** Rendered block replacements can make native vertical movement skip the entire formula. */
export function createMathKeyboardEntry(isActive: (state: EditorState) => boolean): Extension {
	return ViewPlugin.define(view => {
		const capture = (event: KeyboardEvent): void => {
			if (event.target !== view.contentDOM) return;
			if (!['ArrowUp', 'ArrowDown', 'ArrowRight'].includes(event.key) || event.defaultPrevented || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey ||
				event.isComposing || view.composing || !isActive(view.state) || requireCompositionState(view.state) || classifyCurrentSelectionMode(view.state) !== 'caret') return;
			const current = view.state.selection.main;
			if (view.state.selection.ranges.length !== 1 || !current.empty) return;
			if (isVirtualTailActive(view.state)) return;
			let trailingFrom = view.state.doc.length;
			trailing: for (const part of view.state.doc.iterRange(view.state.doc.length, 0)) {
				for (let index = part.length - 1; index >= 0; index--) {
					if (part[index] !== ' ' && part[index] !== '\t' && part[index] !== '\n') break trailing;
					trailingFrom--;
				}
			}
			const expressions = discoverMath(view.state);
			const last = expressions.find(math => math.display && math.to >= trailingFrom && math.from <= current.head);
			if (last && !view.state.readOnly && event.key !== 'ArrowUp') {
				const body = projectMathSource(view.state, last), row = body.bodyLines.at(-1);
				const caret = event.key === 'ArrowDown' ? view.coordsAtPos(current.head) : null;
				const end = event.key === 'ArrowDown' ? view.coordsAtPos(body.to, -1) : null;
				if (event.key === 'ArrowRight' ? current.head === body.to : row && current.head >= row.from && caret && end && caret.top >= end.top - 1) {
					event.preventDefault(); event.stopImmediatePropagation();
					view.dispatch(enterVirtualTail(view.state, { returnTo: current.head, goalColumn: current.goalColumn }));
					return;
				}
			}
			if (event.key === 'ArrowRight') return;
			const forward = event.key === 'ArrowDown', line = view.state.doc.lineAt(current.head);
			const math = expressions.filter(item => item.display && (forward ? item.from > line.to : item.to < line.from))
				.sort((a, b) => forward ? a.from - b.from : b.to - a.to)[0];
			if (!math) return;
			const opening = view.state.doc.lineAt(math.from);
			// A quoted opening's structural prefix belongs to the block, not the gap before it.
			const openingFrom = /^[ \t]*(?:>[ \t]*)*$/u.test(view.state.sliceDoc(opening.from, math.from)) ? opening.from : math.from;
			if (!/^\s*$/u.test(view.state.sliceDoc(forward ? line.to : math.to, forward ? openingFrom : line.from))) return;
			const visual = createVisualNavigationAdapter(view), store = requireGoalXStore(view);
			const goal = store.read() ?? current.goalColumn ?? visual.coordsAtPos({ position: current.head, assoc: current.assoc })?.left;
			if (goal === undefined) return;
			const native = view.moveVertically(EditorSelection.cursor(current.head, current.assoc, undefined, goal), forward);
			if (forward ? native.head <= line.to : native.head >= line.from) return;
			const projection = getParagraphProjectionState(view.state);
			const normalized = projection?.rangeIndex.normalize(native.head, forward ? 1 : -1) ?? native.head;
			if (forward ? normalized < math.from : normalized > math.to) return;
			const body = projectMathSource(view.state, math), entry = forward ? body.from : body.to;
			event.preventDefault(); event.stopImmediatePropagation();
			view.dispatch({ selection: EditorSelection.cursor(entry, forward ? 1 : -1, undefined, goal), userEvent: 'select' });
			// Revealing source first gives the first/last wrapped visual row real CM coordinates.
			const aligned = visual.alignGoalOnVisualLine!({ position: entry, assoc: forward ? 1 : -1 }, goal);
			const head = clampMathBody(body, aligned.position);
			if (head !== entry) view.dispatch({ selection: EditorSelection.cursor(head, aligned.assoc, undefined, goal), userEvent: 'select' });
			store.write(goal);
		};
		view.dom.addEventListener('keydown', capture, true);
		return { destroy() { view.dom.removeEventListener('keydown', capture, true); } };
	});
}
