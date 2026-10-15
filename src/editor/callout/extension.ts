import { createCreationHistory } from '../runtime/creation-history.js';
import { Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { classifyCurrentSelectionMode, compositionStateField, selectionModeAnnotation } from '../runtime/input-state.js';
import { planCalloutInput, planCalloutKey, planEmptyCalloutBackspace, type CalloutKey } from './editing.js';
import { planCalloutClipboard } from './selection.js';
import { projectCallout } from './projection.js';
import { enumerateListItems } from '../structured-list/syntax.js';
import { mathCandidatesActive } from '../math/candidate-ranges.js';
import { mathDraftRanges } from '../math/native-ownership.js';
import { deleteAdjacentMath } from '../math/operations.js';
import { deleteAdjacentCode } from '../code-blocks/operations.js';

export interface CalloutEditingOptions {
	readonly listEditing?: (view: EditorView) => boolean;
	readonly paragraphEditing?: (view: EditorView) => boolean;
}

export function createCalloutExtension(isActive: (view: EditorView) => boolean, options: CalloutEditingOptions = {}): Extension {
	function eligible(view: EditorView): boolean {
		if (!isActive(view) || view.composing) return false;
		const mode = classifyCurrentSelectionMode(view.state);
		if (mode !== 'caret' && mode !== 'continuous') return false;
		const projection = projectCallout(view.state);
		if (!projection) return false;
		const selection = projection.state.selection.main;
		const list = enumerateListItems(projection.state).some(item => item.itemNode.from <= selection.to && item.itemNode.to >= selection.from);
		return (list ? options.listEditing?.(view) : options.paragraphEditing?.(view)) ?? true;
	}
	function run(view: EditorView, key: CalloutKey): boolean {
		if (key === 'Backspace' && isActive(view) && !view.composing && !view.state.field(compositionStateField, false) &&
			classifyCurrentSelectionMode(view.state) === 'caret' && (options.paragraphEditing?.(view) ?? true)) {
			const empty = planEmptyCalloutBackspace(view.state);
			if (empty) { view.dispatch(empty, {annotations:selectionModeAnnotation.of('normal')}); return true; }
		}
		if ((key === 'Backspace' || key === 'Delete') && isActive(view) && deleteAdjacentCode(view, key === 'Delete')) return true;
		if ((key === 'Backspace' || key === 'Delete') && isActive(view) && view.state.facet(mathCandidatesActive) &&
			deleteAdjacentMath(view, key === 'Delete', () => true)) return true;
		if (!eligible(view)) return false;
		if (key === 'Enter' && view.state.facet(mathCandidatesActive) && view.state.selection.ranges.length === 1 &&
			view.state.selection.main.empty && mathDraftRanges(view.state).some(range => range.to === view.state.selection.main.head && range.to - range.from === 2)) return false;
		const plan = !view.state.selection.main.empty && (key === 'Backspace' || key === 'Delete')
			? planCalloutClipboard(view.state, 'cut')?.transaction
			: planCalloutKey(view.state, key);
		if (!plan) return false;
		view.dispatch(plan, { annotations: selectionModeAnnotation.of('normal') });
		return true;
	}
	function clipboard(event: ClipboardEvent, view: EditorView, action: 'copy' | 'cut'): boolean {
		if (!eligible(view) || !event.clipboardData) return false;
		const plan = planCalloutClipboard(view.state, action);
		if (!plan) return false;
		event.clipboardData.setData('text/plain', plan.text);
		if (plan.transaction) view.dispatch(plan.transaction, { annotations: selectionModeAnnotation.of('normal') });
		return true;
	}
	const keys: readonly CalloutKey[] = ['Enter', 'Shift-Enter', 'Tab', 'Shift-Tab', 'Backspace', 'Delete'];
	return [createCreationHistory('container', (_state, view) => isActive(view) && (options.paragraphEditing?.(view) ?? true)),
		Prec.highest(keymap.of(keys.map((key) => ({ key, run: (view) => run(view, key) })))),
		EditorView.inputHandler.of((view, from, to, text) => {
			if (!eligible(view)) return false;
			const plan = planCalloutInput(view.state, from, to, text);
			if (!plan) return false;
			view.dispatch(plan, { annotations: selectionModeAnnotation.of('normal') });
			return true;
		}),
		EditorView.domEventHandlers({ copy: (event, view) => clipboard(event, view, 'copy'),
			cut: (event, view) => clipboard(event, view, 'cut') })];
}
