import type { EditorState, TransactionSpec } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { buildSelectionContext } from '../structured-list/context.js';
import { serializeSelection } from '../structured-list/clipboard.js';
import { validateEditPlan } from '../structured-list/edit-plan.js';
import { executeRegisteredOperation } from '../structured-list/operations.js';
import { enumerateListItems } from '../structured-list/syntax.js';
import { mapCalloutPlan, planCalloutInput } from './editing.js';
import { projectCallout } from './projection.js';
import { hasNativeOwnership } from './syntax.js';

export function planCalloutClipboard(state: EditorState, action: 'copy' | 'cut'):
	{ readonly text: string; readonly transaction: TransactionSpec | null } | null {
	if (state.selection.ranges.length !== 1 || state.selection.main.empty) return null;
	const projection = projectCallout(state);
	if (!projection) return null;
	const virtual = projection.state;
	if (hasNativeOwnership(syntaxTree(virtual), virtual.selection.main.from, virtual.selection.main.to)) return null;
	let mixedContainer = false;
	syntaxTree(virtual).iterate({ from: virtual.selection.main.from, to: virtual.selection.main.to,
		enter(node) {
			if (['Blockquote', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'Table'].includes(node.name)) mixedContainer = true;
		} });
	if (mixedContainer) return null;
	const text = state.sliceDoc(state.selection.main.from, state.selection.main.to);
	const context = buildSelectionContext(virtual, virtual.selection, {
		operation: 'normal-selection', editIntent: action === 'cut' ? 'cut' : 'none',
		imeComposing: false, selectionMode: 'continuous', selectionsCount: 1,
	});
	if (!context) {
		return { text, transaction: action === 'copy' ? null : planCalloutInput(state, state.selection.main.from, state.selection.main.to, '') };
	}
	const result = executeRegisteredOperation({
		context, intent: { operation: 'normal-selection', family: 'selection', mode: 'continuous',
			action, selection: context.selection },
		services: { serialize: serializeSelection, clipboard: { writeText() { /* Returned to the DOM clipboard event. */ } } },
	});
	if (result.kind !== 'clipboard') return null;
	if (!result.edit) return { text, transaction: null };
	validateEditPlan(virtual.doc.toString(), result.edit, {
		expectedOperation: 'normal-selection', expectedScope: context.editScope,
		authoritativeProtectedRanges: enumerateListItems(virtual).map((item) => item.prefix.full),
	});
	return { text, transaction: mapCalloutPlan(state, projection, result.edit) };
}
