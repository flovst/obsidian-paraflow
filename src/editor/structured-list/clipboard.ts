import type { SelectionContext } from './model.js';

/** Copy exactly the selected source, including partial structural prefixes. */
export function serializeSelection(context: SelectionContext): string {
	const { anchor, head } = context.selection;
	return context.source.slice({ from: Math.min(anchor, head), to: Math.max(anchor, head) });
}
