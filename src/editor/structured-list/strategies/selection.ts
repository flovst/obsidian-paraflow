import { createSelectionCutPlan, mapVisibleSelection } from '../primitives.js';
import type { OperationHandler, OperationResult } from '../operations.js';

function clipboardResult(
	execution: Parameters<OperationHandler<'normal-selection'>>[0],
): OperationResult {
	const text = execution.services.serialize(execution.context);
	if (execution.intent.action === 'copy') return { edit: null, kind: 'clipboard', text };
	const edit = createSelectionCutPlan(execution.context, execution.services.capabilities);
	return edit ? { edit, kind: 'clipboard', text } : { kind: 'pass-through' };
}

export const normalSelection: OperationHandler<'normal-selection'> = (execution) => {
	if (execution.intent.action === 'map') {
		return {
			kind: 'selection',
			selection: mapVisibleSelection(execution.context, execution.intent.selection),
		};
	}
	return clipboardResult(execution);
};
