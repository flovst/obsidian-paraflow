import type { SelectionContext, SelectionSegment } from './model.js';

function listFamily(segment: SelectionSegment): 'ordered' | 'unordered' | null {
	if (!segment.prefix) return null;
	return segment.prefix.kind === 'ordered' ? 'ordered' : 'unordered';
}

function serializedSegment(context: SelectionContext, segment: SelectionSegment): string {
	if (segment.kind === 'ordinary' || !segment.prefix) {
		return context.source.slice(segment.source);
	}
	const indent = segment.source.from <= segment.prefix.full.from
		? context.source.slice({ from: segment.source.from, to: segment.prefix.full.from })
		: segment.prefix.indentText;
	const prefix = `${indent}${context.source.slice(segment.prefix.full)}`;
	const content = context.source.slice(segment.selectedContent);
	const trailing = context.source.slice({
		from: segment.selectedContent.to,
		to: segment.source.to,
	});
	return `${prefix}${content}${trailing}`;
}

function needsBlockSeparator(
	previous: SelectionSegment | undefined,
	current: SelectionSegment,
): boolean {
	const previousFamily = previous ? listFamily(previous) : null;
	const currentFamily = listFamily(current);
	return previousFamily !== null && currentFamily !== null && previousFamily !== currentFamily;
}

export function serializeSelection(context: SelectionContext): string {
	return context.segments.map((segment, index) => {
		const separator = needsBlockSeparator(context.segments[index - 1], segment) ? '\n' : '';
		return `${separator}${serializedSegment(context, segment)}`;
	}).join('');
}
