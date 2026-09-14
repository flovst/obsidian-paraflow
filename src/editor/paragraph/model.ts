export interface ParagraphBlock {
	readonly from: number;
	readonly to: number;
}

export type TopLevelBlockBoundaryKind =
	| 'paragraph'
	| 'heading'
	| 'list-item'
	| 'separatorless-list-literal';

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
