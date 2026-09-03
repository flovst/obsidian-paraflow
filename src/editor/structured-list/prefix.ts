import type { ListPrefix, PrefixPolicy, SourceRange } from './model.js';

interface MarkerMatch {
	readonly indentText: string;
	readonly markerText: string;
	readonly orderedValue: number | null;
	readonly separatorText: string;
	readonly markerEnd: number;
}

function range(from: number, to: number): SourceRange {
	return { from, to };
}

function parseMarker(lineText: string): MarkerMatch | null {
	const match = /^([ \t]*)([-+*]|\d+[.)])([ \t]+|$)/u.exec(lineText);
	if (!match) return null;
	const [matched, indentText, markerText, separatorText] = match;
	if (indentText === undefined || markerText === undefined || separatorText === undefined) return null;
	const orderedValue = /^\d/u.test(markerText) ? Number.parseInt(markerText, 10) : null;
	return { indentText, markerEnd: matched.length, markerText, orderedValue, separatorText };
}

function parsePrefix(lineText: string, lineFrom: number): ListPrefix | null {
	const marker = parseMarker(lineText);
	if (!marker) return null;

	const outerMarkerEnd = lineFrom + marker.markerEnd;
	const taskMatch = /^\[[ xX]\]([ \t]+)/u.exec(lineText.slice(marker.markerEnd));
	if (!taskMatch) {
		return {
			full: range(lineFrom, outerMarkerEnd),
			indentText: marker.indentText,
			kind: marker.orderedValue === null ? 'unordered' : 'ordered',
			markerText: marker.markerText,
			orderedValue: marker.orderedValue,
			outerMarker: range(lineFrom, outerMarkerEnd),
			separatorText: marker.separatorText,
			taskToken: null,
		};
	}

	const taskTokenEnd = outerMarkerEnd + taskMatch[0].length;
	return {
		full: range(lineFrom, taskTokenEnd),
		indentText: marker.indentText,
		kind: 'task',
		markerText: marker.markerText,
		orderedValue: marker.orderedValue,
		outerMarker: range(lineFrom, outerMarkerEnd),
		separatorText: marker.separatorText,
		taskToken: range(outerMarkerEnd, taskTokenEnd),
	};
}

function orderedMarker(prefix: ListPrefix, orderedValue: number | undefined): string {
	const value = orderedValue ?? prefix.orderedValue;
	if (value === null) throw new Error('Ordered prefixes require an ordered value');
	const delimiter = prefix.markerText.endsWith(')') ? ')' : '.';
	return `${value}${delimiter}${prefix.separatorText}`;
}

function renderSameLevel(
	prefix: ListPrefix,
	options: { readonly orderedValue?: number; readonly taskState?: ' ' | 'x' },
): string {
	if (prefix.kind === 'ordered') return orderedMarker(prefix, options.orderedValue);
	if (prefix.kind === 'task') {
		const taskState = options.taskState ?? ' ';
		const marker = prefix.orderedValue === null
			? `${prefix.markerText}${prefix.separatorText}`
			: orderedMarker(prefix, options.orderedValue);
		return `${marker}[${taskState}]${prefix.separatorText}`;
	}
	return `${prefix.markerText}${prefix.separatorText}`;
}

function contentIndent(prefix: ListPrefix): string {
	const prefixWidth = prefix.full.to - prefix.full.from - prefix.indentText.length;
	return `${prefix.indentText}${' '.repeat(prefixWidth)}`;
}

export const prefixPolicy: PrefixPolicy = {
	contentIndent,
	parse: parsePrefix,
	renderSameLevel,
};
