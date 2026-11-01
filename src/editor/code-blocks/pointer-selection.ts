import { EditorSelection } from '@codemirror/state';
import type { EditorView, MouseSelectionStyle } from '@codemirror/view';
import { codeBodyStart } from './editable-boundaries.js';
import type { CodeBlock } from './source-scan.js';

/** A gesture starting in code owns its body; outside gestures keep normal cross-block selection. */
export function codeBodyPointerSelection(view: EditorView, event: MouseEvent, blocks: readonly CodeBlock[]): MouseSelectionStyle | null {
	const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
	if (position === null) return null;
	const block = blocks.find(candidate => candidate.lines.length && position >= codeBodyStart(view.state, candidate) && position <= candidate.lines.at(-1)!.to);
	if (!block) return null;
	let first = codeBodyStart(view.state, block), last = block.lines.at(-1)!.to;
	let start = view.state.selection;
	if (event.shiftKey && (start.main.anchor < first || start.main.anchor > last)) return null;
	// Preserve the host's drag-and-drop of an existing selection.
	if (!event.shiftKey && event.detail < 2 && !start.main.empty && position >= start.main.from && position <= start.main.to) return null;
	const clamp = (value: number) => Math.max(first, Math.min(last, value));
	const unit = (value: number) => {
		if (event.detail >= 3) { const line = view.state.doc.lineAt(value); return EditorSelection.range(clamp(line.from), clamp(line.to)); }
		const word = event.detail === 2 ? view.state.wordAt(value) : null;
		return word ? EditorSelection.range(clamp(word.from), clamp(word.to)) : EditorSelection.cursor(clamp(value));
	};
	let origin = unit(position);
	return {
		update(update) {
			first = update.changes.mapPos(first, -1); last = update.changes.mapPos(last, 1);
			origin = origin.map(update.changes); start = start.map(update.changes);
		},
		get(current, extend, multiple) {
			const position = current === event ? origin.head : view.posAtCoords({ x: current.clientX, y: current.clientY }, false);
			const target = unit(clamp(position));
			const range = extend ? start.main.extend(target.from, target.to) : target.from < origin.from
				? EditorSelection.range(origin.to, target.from) : EditorSelection.range(origin.from, target.to);
			return extend ? start.replaceRange(range) : multiple ? start.addRange(range) : EditorSelection.create([range]);
		},
	};
}
