export interface ParagraphBlock {
	readonly from: number;
	readonly to: number;
}

export type TopLevelBlockBoundaryKind =
	| 'paragraph'
	| 'heading'
	| 'list-item'
	| 'separatorless-list-literal'
	| 'blockquote'
	| 'code-block'
	| 'table'
	| 'thematic-break'
	| 'math-block'
	| 'html-block';

export interface TopLevelBlockCapabilities {
	readonly containment: 'leaf' | 'container';
	readonly gapBoundary: boolean;
	readonly paragraphEnter: boolean;
	readonly verticalEntry: 'paraflow' | 'host';
	readonly verticalNavigation: 'paraflow' | 'host';
}

const blockCapabilities: Readonly<Record<
	TopLevelBlockBoundaryKind,
	TopLevelBlockCapabilities
>> = Object.freeze({
	paragraph: Object.freeze({
		containment: 'leaf', gapBoundary: true,
		paragraphEnter: true, verticalEntry: 'paraflow', verticalNavigation: 'paraflow',
	}),
	heading: Object.freeze({
		containment: 'leaf', gapBoundary: true,
		paragraphEnter: false, verticalEntry: 'paraflow', verticalNavigation: 'paraflow',
	}),
	'list-item': Object.freeze({
		containment: 'container', gapBoundary: true,
		paragraphEnter: false, verticalEntry: 'paraflow', verticalNavigation: 'paraflow',
	}),
	'separatorless-list-literal': Object.freeze({
		containment: 'leaf', gapBoundary: true,
		paragraphEnter: false, verticalEntry: 'paraflow', verticalNavigation: 'paraflow',
	}),
	blockquote: Object.freeze({
		containment: 'container', gapBoundary: true,
		paragraphEnter: false, verticalEntry: 'paraflow', verticalNavigation: 'host',
	}),
	'code-block': Object.freeze({
		containment: 'container', gapBoundary: true,
		paragraphEnter: false, verticalEntry: 'paraflow', verticalNavigation: 'host',
	}),
	table: Object.freeze({
		containment: 'container', gapBoundary: true,
		paragraphEnter: false, verticalEntry: 'host', verticalNavigation: 'host',
	}),
	'thematic-break': Object.freeze({
		containment: 'leaf', gapBoundary: true,
		paragraphEnter: false, verticalEntry: 'host', verticalNavigation: 'host',
	}),
	'math-block': Object.freeze({
		containment: 'container', gapBoundary: true,
		paragraphEnter: false, verticalEntry: 'host', verticalNavigation: 'host',
	}),
	'html-block': Object.freeze({
		containment: 'container', gapBoundary: true,
		paragraphEnter: false, verticalEntry: 'host', verticalNavigation: 'host',
	}),
});

export function capabilitiesForTopLevelBlock(
	kind: TopLevelBlockBoundaryKind,
): TopLevelBlockCapabilities {
	return blockCapabilities[kind];
}

export interface TopLevelBlockBoundary extends ParagraphBlock {
	readonly kind: TopLevelBlockBoundaryKind;
}

export interface AtxHeadingBlock extends ParagraphBlock {
	readonly contentFrom: number;
	readonly level: 1 | 2 | 3 | 4 | 5 | 6;
	readonly prefixFrom: number;
	readonly prefixTo: number;
}

export interface ParagraphGap {
	readonly from: number;
	readonly to: number;
}

export interface ParagraphPhysicalRow {
	readonly at: number;
	readonly kind: 'gap-head' | 'editable' | 'folded';
}

export interface ParagraphRun {
	readonly kind: 'leading' | 'middle' | 'trailing';
	readonly from: number;
	readonly to: number;
	readonly gaps: readonly ParagraphGap[];
	readonly editableAnchors: readonly number[];
	readonly rows: readonly ParagraphPhysicalRow[];
}

export interface ParagraphAuthority {
	readonly blocks: readonly TopLevelBlockBoundary[];
	readonly complete: boolean;
	readonly paragraphs: readonly ParagraphBlock[];
	readonly boundaries: readonly ParagraphBlock[];
	readonly runs: readonly ParagraphRun[];
}
