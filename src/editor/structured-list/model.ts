import type { EditScope } from './edit-plan.js';
import type { HandledOperationId } from './operations.js';

export interface SourceRange {
	readonly from: number;
	readonly to: number;
}

export interface SourceSnapshot {
	readonly length: number;
	readonly text: string;
	slice(range: SourceRange): string;
}

export interface SelectionSnapshot {
	readonly anchor: number;
	readonly head: number;
	readonly empty: boolean;
}

export type SiblingPosition = 'first' | 'middle' | 'final' | 'only';
export type OwnedBlockKind = 'continuation' | 'additional-paragraph' | 'descendant';

export interface ListPrefix {
	readonly kind: 'unordered' | 'ordered' | 'task';
	readonly full: SourceRange;
	readonly outerMarker: SourceRange;
	readonly taskToken: SourceRange | null;
	readonly markerText: string;
	readonly orderedValue: number | null;
	readonly indentText: string;
	readonly separatorText: string;
}

export interface ListBlockRef {
	readonly item: SourceRange;
	readonly markerLine: SourceRange;
	readonly content: SourceRange;
	readonly lineFrom: number;
	readonly contentIndentText: string;
	readonly prefix: ListPrefix;
}

export interface OwnedBlock {
	readonly kind: OwnedBlockKind;
	readonly range: SourceRange;
	readonly indentText: string;
	readonly relativeDepth: number;
}

export type BoundaryAnchor =
	| 'previous-block'
	| 'current-marker-line'
	| `owned-block:${number}`
	| 'following-block'
	| 'document-end';

export interface WhitespaceLineFact {
	readonly range: SourceRange;
	readonly text: string;
	readonly kind: 'empty' | 'ascii-spaces' | 'tabs' | 'sentinel-tab' | 'mixed-whitespace';
}

export interface WhitespaceBoundaryFact {
	readonly fromAnchor: BoundaryAnchor;
	readonly toAnchor: BoundaryAnchor;
	readonly range: SourceRange;
	readonly newlineCount: number;
	readonly lines: readonly WhitespaceLineFact[];
	readonly atDocumentEnd: boolean;
}

export type FollowingBoundary =
	| { readonly kind: 'list-item'; readonly block: ListBlockRef }
	| { readonly kind: 'continuation'; readonly range: SourceRange }
	| { readonly kind: 'additional-paragraph'; readonly range: SourceRange }
	| { readonly kind: 'ordinary-paragraph'; readonly range: SourceRange }
	| { readonly kind: 'terminal-newlines'; readonly count: number }
	| { readonly kind: 'none' }
	| { readonly kind: 'unsupported' };

export type RemovableFollowingBoundary = Extract<
	FollowingBoundary,
	{
		readonly kind:
			| 'list-item'
			| 'continuation'
			| 'additional-paragraph'
			| 'ordinary-paragraph'
			| 'terminal-newlines';
	}
>;

export interface NormalizedStructuralBoundary {
	readonly id: `structural-boundary:${number}`;
	readonly following: RemovableFollowingBoundary;
	readonly whitespace: WhitespaceBoundaryFact;
	readonly whitespaceIndex: number;
	readonly removalRange: SourceRange;
}

export interface OrderedSequenceContext {
	readonly items: readonly ListBlockRef[];
	readonly currentIndex: number;
	readonly renderedValue: number;
}

export type ShiftTabTrailingBlankPolicy =
	| { readonly kind: 'none' }
	| {
			readonly kind: 'around-next-sibling';
			readonly beforeBoundaryIndex: number;
			readonly nextSibling: ListBlockRef;
	  };

export interface ProjectionListContext {
	readonly block: ListBlockRef;
	readonly depth: number;
	readonly orderedSequence: OrderedSequenceContext | null;
}

export interface ListTopology {
	readonly depth: number;
	readonly siblingPosition: SiblingPosition;
	readonly parent: ListBlockRef | null;
	readonly precedingContainer: ListBlockRef | null;
	readonly previousSibling: ListBlockRef | null;
	readonly nextSibling: ListBlockRef | null;
	readonly ownedBlocks: readonly OwnedBlock[];
	readonly whitespaceBoundaries: readonly WhitespaceBoundaryFact[];
	readonly structuralBoundaries: readonly NormalizedStructuralBoundary[];
	readonly followingBoundary: FollowingBoundary;
	readonly followingStructuralBoundary: NormalizedStructuralBoundary | null;
	readonly orderedSequence: OrderedSequenceContext | null;
	readonly parentOrderedSequence: OrderedSequenceContext | null;
	readonly shiftTabTrailingBlankPolicy: ShiftTabTrailingBlankPolicy;
	readonly atDocumentStart: boolean;
	readonly atDocumentEnd: boolean;
}

export interface ListContext {
	readonly current: ListBlockRef;
	readonly source: SourceSnapshot;
	readonly caret: number;
	readonly selection: SelectionSnapshot;
	readonly caretZone: 'start' | 'middle' | 'end' | 'empty';
	readonly topology: ListTopology;
	readonly editScope: EditScope;
}

export interface PrefixPolicy {
	parse(lineText: string, lineFrom: number): ListPrefix | null;
	renderSameLevel(
		prefix: ListPrefix,
		options: { readonly orderedValue?: number; readonly taskState?: ' ' | 'x' },
	): string;
	contentIndent(prefix: ListPrefix): string;
}

export interface ListItemSyntax {
	readonly itemNode: SourceRange;
	readonly markerLine: SourceRange;
	readonly prefix: ListPrefix;
}

export type ProjectionInvalidation =
	| { readonly kind: 'map-only' }
	| { readonly kind: 'rebuild-ranges'; readonly ranges: readonly SourceRange[] }
	| { readonly kind: 'rebuild-all' };

export type NavigationContext =
	| {
		readonly kind: 'list';
		readonly list: ListContext;
		readonly editScope: EditScope;
		readonly assoc: VisualAssociation;
	}
	| {
			readonly assoc: VisualAssociation;
			readonly kind: 'ordinary';
			readonly source: SourceSnapshot;
			readonly line: SourceRange;
			readonly caret: number;
			readonly selection: SelectionSnapshot;
			readonly editScope: EditScope;
	  };

export interface SelectionSegment {
	readonly kind: 'ordinary' | 'list-content';
	readonly source: SourceRange;
	readonly prefix: ListPrefix | null;
	readonly selectedContent: SourceRange;
}

export interface SelectionContext {
	readonly source: SourceSnapshot;
	readonly selection: SelectionSnapshot;
	readonly segments: readonly SelectionSegment[];
	readonly protectedRanges: readonly SourceRange[];
	readonly editScope: EditScope;
}

export interface StructuredListRangeIndex {
	readonly protectedRanges: readonly SourceRange[];
	containing(position: number): SourceRange | null;
	mapEndpoint(position: number, bias: -1 | 1): number;
}

export type VisualAssociation = -1 | 0 | 1;

export interface VisualPosition {
	readonly position: number;
	readonly assoc: VisualAssociation;
}

export interface NavigationDestination extends VisualPosition {
	readonly context: NavigationContext;
}

export interface ContextRuntime {
	readonly operation: HandledOperationId;
	readonly editIntent: 'structural' | 'conditional-terminal' | 'cut' | 'none';
	readonly selectionsCount: number;
	readonly imeComposing: boolean;
	readonly selectionMode:
		| 'caret'
		| 'continuous'
		| 'unknown'
		| 'whole-document'
		| 'whole-item'
		| 'column'
		| 'third-party';
}
