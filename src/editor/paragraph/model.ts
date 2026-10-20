export interface ParagraphBlock {
	readonly from: number;
	readonly to: number;
}

export interface ParagraphEndpointIndex<T extends ParagraphBlock> {
	readonly byStart: ReadonlyMap<number, T>;
	readonly byEnd: ReadonlyMap<number, T>;
}

/** Keep the first source entry at duplicate endpoints, matching exact Array.find. */
export function createParagraphEndpointIndex<T extends ParagraphBlock>(
	blocks: readonly T[],
): ParagraphEndpointIndex<T> {
	const byStart = new Map<number, T>(), byEnd = new Map<number, T>();
	for (const block of blocks) {
		if (!byStart.has(block.from)) byStart.set(block.from, block);
		if (!byEnd.has(block.to)) byEnd.set(block.to, block);
	}
	return { byStart, byEnd };
}

export type TopLevelBlockBoundaryKind =
	| 'paragraph'
	| 'media'
	| 'heading'
	| 'list-item'
	| 'separatorless-list-literal'
	| 'blockquote'
	| 'code-block'
	| 'table'
	| 'thematic-break'
	| 'footnote-definition'
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
	media: Object.freeze({
		containment: 'leaf', gapBoundary: true,
		paragraphEnter: false, verticalEntry: 'host', verticalNavigation: 'host',
	}),
	'footnote-definition': Object.freeze({
		containment: 'container', gapBoundary: true,
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
	readonly headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

/** Visual families survive projection so each block can supply its own edge tokens. */
export function paragraphBoundaryTag(block: TopLevelBlockBoundary | undefined): string {
	if (!block) return 'block';
	if (block.kind === 'paragraph') return 'p';
	if (block.kind === 'heading') return `h${block.headingLevel!}`;
	return block.kind;
}

export interface AtxHeadingBlock extends ParagraphBlock {
	readonly contentFrom: number;
	readonly level: 1 | 2 | 3 | 4 | 5 | 6;
	readonly prefixFrom: number;
	readonly prefixTo: number;
}

export interface SetextHeadingBlock extends ParagraphBlock {
	readonly contentFrom: number;
	readonly contentTo: number;
	readonly level: 1 | 2;
	readonly underlineFrom: number;
	readonly underlineTo: number;
	readonly topLevel: boolean;
	readonly lines: readonly { readonly from: number; readonly contentFrom: number; readonly to: number }[];
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

/** Editable empty bodies delimit ordinary paragraphs within a multi-gap run. */
export function paragraphGapTags(
	blocks: readonly TopLevelBlockBoundary[],
	run: ParagraphRun,
	endpoints?: ParagraphEndpointIndex<TopLevelBlockBoundary>,
):
	(position: number) => { before: string; after: string } {
	const before = paragraphBoundaryTag(endpoints ? endpoints.byEnd.get(run.from) : blocks.find(block => block.to === run.from));
	const after = paragraphBoundaryTag(endpoints ? endpoints.byStart.get(run.to) : blocks.find(block => block.from === run.to));
	const editable = run.rows.filter(row => row.kind === 'editable');
	const first = editable[0]?.at ?? Infinity;
	const last = editable.at(-1)?.at ?? -Infinity;
	return position => ({ before: first <= position ? 'p' : before, after: last > position ? 'p' : after });
}
