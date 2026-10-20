import { Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';

export interface SelectableBlockBody {
	readonly from: number;
	readonly to: number;
	readonly lines: readonly { from: number; to: number }[];
	readonly prefix: string;
	/** A virtual math body occupies the closing delimiter's row until first input. */
	readonly materializeAfter?: string;
}

/** Select an editable body without exposing its structural delimiters. */
function selectBlockBody(view: EditorView, body: { from: number; to: number }): boolean {
	const selection = view.state.selection;
	if (selection.ranges.length !== 1 || selection.main.from < body.from || selection.main.to > body.to) return false;
	view.dispatch({ selection: { anchor: body.from, head: body.to }, userEvent: 'select', scrollIntoView: true });
	return true;
}

/** Clipboard text belongs to the body; hidden quote/list prefixes stay structural. */
export function createBlockBodySelection(bodyAt: (view: EditorView) => SelectableBlockBody | null): Extension {
	const selected = (view: EditorView): SelectableBlockBody | null => {
		const body = bodyAt(view), selection = view.state.selection;
		return body && selection.ranges.length === 1 &&
			selection.main.from === body.from && selection.main.to === body.to ? body : null;
	};
	const replace = (view: EditorView, body: SelectableBlockBody, text: string, userEvent: string): void => {
		const insert = text.replace(/\r\n?/gu, '\n').replace(/\n/gu, '\n' + body.prefix);
		view.dispatch({ changes: { from: body.from, to: body.to, insert: insert + (insert ? body.materializeAfter ?? '' : '') }, selection: { anchor: body.from + insert.length },
			userEvent, scrollIntoView: true, annotations: isolateHistory.of('full') });
	};
	const clipboard = (event: ClipboardEvent, view: EditorView, cut: boolean): boolean => {
		const body = selected(view);
		if (!body || !event.clipboardData) return false;
		event.clipboardData.setData('text/plain', body.lines.map(line => view.state.sliceDoc(line.from, line.to)).join('\n'));
		if (cut && body.from < body.to && !view.state.readOnly) replace(view, body, '', 'delete.cut');
		return true;
	};
	return Prec.highest([
		keymap.of([{ key: 'Mod-a', run: view => {
			const body = bodyAt(view);
			return !!body && selectBlockBody(view, body);
		} }]),
		EditorView.domEventHandlers({
			copy: (event, view) => clipboard(event, view, false),
			cut: (event, view) => clipboard(event, view, true),
			paste: (event, view) => {
				const body = selected(view), data = event.clipboardData;
				if (!body || view.state.readOnly || !data || data.files.length || !data.types.includes('text/plain')) return false;
				replace(view, body, data.getData('text/plain'), 'input.paste');
				return true;
			},
		}),
		EditorView.inputHandler.of((view, from, to, text) => {
			const body = selected(view);
			if (!body || view.state.readOnly || from !== body.from || to !== body.to) return false;
			replace(view, body, text, 'input.type');
			return true;
		}),
	]);
}
