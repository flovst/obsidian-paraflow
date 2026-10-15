import { Prec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** Keep literal Markdown typing without changing the host's bracket settings. */
export function createMarkdownPairingPolicy(isPrimaryEditor: (view: EditorView) => boolean): Extension {
	return Prec.highest(EditorView.inputHandler.of((view, from, to, text, insert) => {
		if (!isPrimaryEditor(view) || view.composing || view.state.readOnly ||
			from !== to || view.state.selection.ranges.some(range => !range.empty) ||
			(text !== '`' && text !== '*' && text !== '_')) return false;
		view.dispatch(insert());
		return true;
	}));
}
