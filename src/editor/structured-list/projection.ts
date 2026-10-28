import { createDetachedEl } from '../../dom';
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import {
	Facet,
	Prec,
	RangeSet,
	RangeValue,
	StateField,
	type EditorState,
	type Extension,
	type Range,
	type Transaction,
} from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { buildProjectionContexts } from './context.js';
import { structuralEditAnnotation } from './edit-plan.js';
import { listBlankRuns, mapListBlankRuns, type ListBlankRun } from './blank-runs.js';
import { createListEmptyBodyState } from './empty-body-state.js';
import { emptyBodyState, createdBodyOwnershipState } from '../runtime/empty-body-state.js';
import { emptyVisualLineAnchor } from '../runtime/navigation-core.js';
import {
	markerForProjection,
	StructuredListMarkerWidget,
	StructuredListSeparatorWidget,
	StructuredListEmptyBodyWidget,
	TaskPrefixWidget,
	type StructuredListMarker,
} from './marker-widget.js';
import type {
	ProjectionInvalidation,
	ProjectionOwnedLine,
	SourceRange,
	StructuredListRangeIndex,
} from './model.js';
import { prefixPolicy } from './prefix.js';
import {
	discoverListItem,
	enumerateListItems,
	isObsidianListLineName,
} from './syntax.js';

export interface StructuredListProjectionOptions {
	readonly isLivePreview: (state: EditorState) => boolean;
	readonly isActive?: (view: EditorView) => boolean;
}

export interface StructuredListProjectionState {
	readonly decorations: DecorationSet;
	readonly atomicRanges: RangeSet<RangeValue>;
	readonly rangeIndex: StructuredListRangeIndex;
}

export interface StructuredListTaskToken extends SourceRange {
	readonly checked: boolean;
}

export type StructuredListProjectionWork = 'authority' | 'contexts' | 'enumerate';

export interface ProjectionEntry extends ProjectionAuthorityItem {
	readonly collapsedSeparator: SourceRange | null;
	readonly widget: StructuredListMarkerWidget;
}

/** Containers contribute source-mapped entries; all list consumers share this index. */
export const containerListProjections = Facet.define<(state: EditorState) => readonly ProjectionEntry[]>();
const combinedProjections = new WeakMap<EditorState, ProjectionFieldState>();

interface ProjectionFieldState extends StructuredListProjectionState {
	readonly active: boolean;
	readonly authority: ProjectionAuthority | null;
	readonly entries: readonly ProjectionEntry[];
}

interface ChangedSpan {
	readonly oldRange: SourceRange;
	readonly newRange: SourceRange;
}

interface ListPathNode extends SourceRange {
	readonly name: string;
}

interface ListEnvelope extends SourceRange {
	readonly name: 'BulletList' | 'OrderedList';
}

interface ProjectionAuthorityItem {
	readonly blankRuns?: readonly ListBlankRun[];
	readonly item: SourceRange;
	readonly marker: StructuredListMarker;
	readonly ownedLines: readonly ProjectionOwnedLine[];
	readonly prefix: SourceRange;
	readonly replacement: SourceRange;
	readonly taskToken: SourceRange | null;
}

interface ProjectionAuthority {
	readonly envelopes: readonly ListEnvelope[];
	readonly items: readonly ProjectionAuthorityItem[];
	readonly syntax: ProjectionSyntaxAuthority;
}

interface ProjectionSyntaxAuthority {
	readonly complete: boolean;
	readonly parsedTo: number;
	readonly tree: Tree;
}

interface ProjectionAnalysis {
	readonly authority: ProjectionAuthority;
	readonly entries: readonly ProjectionEntry[];
}

interface ProjectionUpdateDecision {
	readonly analysis: ProjectionAnalysis | null;
	readonly invalidation: ProjectionInvalidation;
	readonly mappedSyntax?: ProjectionSyntaxAuthority;
}

interface SyntaxFingerprintNode extends SourceRange {
	readonly name: string;
}

type SpanSyntax =
	| { readonly kind: 'ambiguous' }
	| { readonly kind: 'outside' }
	| { readonly kind: 'list'; readonly path: readonly ListPathNode[] };

class PrefixRangeValue extends RangeValue {
	eq(other: RangeValue): boolean {
		return other instanceof PrefixRangeValue;
	}
}

const prefixRangeValue = new PrefixRangeValue();
const livePreviewPredicates = Facet.define<
	StructuredListProjectionOptions['isLivePreview']
>();
const projectionWorkObservers = Facet.define<
	(work: StructuredListProjectionWork) => void
>();
const inactiveProjectionUpdate = Symbol('inactive-projection-update');
const projectionFieldUpdateDecisions = new WeakMap<
	Transaction,
	typeof inactiveProjectionUpdate | ProjectionUpdateDecision
>();
const publicProjectionInvalidations = new WeakMap<Transaction, ProjectionInvalidation>();

function recordProjectionWork(state: EditorState, work: StructuredListProjectionWork): void {
	for (const observer of state.facet(projectionWorkObservers)) observer(work);
}

function enumerateProjectionItems(
	state: EditorState,
	within?: readonly SourceRange[],
): ReturnType<typeof enumerateListItems> {
	recordProjectionWork(state, 'enumerate');
	return enumerateListItems(state, within);
}

function projectionContexts(
	state: EditorState,
	items: ReturnType<typeof enumerateListItems>,
): ReturnType<typeof buildProjectionContexts> {
	recordProjectionWork(state, 'contexts');
	return buildProjectionContexts(state, items);
}

export function observeStructuredListProjectionWork(
	observer: (work: StructuredListProjectionWork) => void,
): Extension {
	return projectionWorkObservers.of(observer);
}

function changedSpans(transaction: Transaction): readonly ChangedSpan[] {
	const spans: ChangedSpan[] = [];
	transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
		spans.push({
			newRange: { from: fromB, to: toB },
			oldRange: { from: fromA, to: toA },
		});
	});
	return spans;
}

function changedTextHasNewline(transaction: Transaction, span: ChangedSpan): boolean {
	const oldText = transaction.startState.sliceDoc(span.oldRange.from, span.oldRange.to);
	const newText = transaction.state.sliceDoc(span.newRange.from, span.newRange.to);
	return oldText.includes('\n') || newText.includes('\n');
}

function intersectsChange(range: SourceRange, change: SourceRange): boolean {
	if (change.from === change.to) return range.from <= change.from && change.from < range.to;
	return range.from < change.to && change.from < range.to;
}

function discoveryPositions(state: EditorState, change: SourceRange): readonly number[] {
	const positions = new Set([
		change.from,
		change.to,
		change.from - 1,
		change.to - 1,
	]);
	return [...positions].map((position) => Math.max(0, Math.min(position, state.doc.length)));
}

function changeTouchesPrefix(state: EditorState, change: SourceRange): boolean {
	return discoveryPositions(state, change).some((position) => {
		const item = discoverListItem(state, position);
		return item !== null && intersectsChange(item.prefix.full, change);
	});
}

function hasPrefixBoundaryChange(
	transaction: Transaction,
	spans: readonly ChangedSpan[],
): boolean {
	return spans.some((span) =>
		changeTouchesPrefix(transaction.startState, span.oldRange) ||
		changeTouchesPrefix(transaction.state, span.newRange));
}

function isListPathNode(node: SyntaxNode): boolean {
	return node.name === 'BulletList' || node.name === 'OrderedList' || node.name === 'ListItem' ||
		isObsidianListLineName(node.name);
}

function isListEnvelopeName(name: string): name is ListEnvelope['name'] {
	return name === 'BulletList' || name === 'OrderedList';
}

function hasListEnvelopeAncestor(node: SyntaxNode | null): boolean {
	for (let current = node; current; current = current.parent) {
		if (isListEnvelopeName(current.name)) return true;
	}
	return false;
}

function completeListEnvelopes(state: EditorState): readonly ListEnvelope[] {
	const envelopes: ListEnvelope[] = [];
	syntaxTree(state).iterate({
		enter: (node) => {
			if (!isListEnvelopeName(node.name) || hasListEnvelopeAncestor(node.node.parent)) return;
			envelopes.push({ from: node.from, name: node.name, to: node.to });
		},
	});
	return envelopes;
}

function listPathAt(state: EditorState, position: number, side: -1 | 1): readonly ListPathNode[] {
	const path: ListPathNode[] = [];
	for (let node: SyntaxNode | null = syntaxTree(state).resolve(position, side); node; node = node.parent) {
		if (isListPathNode(node)) path.push({ from: node.from, name: node.name, to: node.to });
	}
	return path.reverse();
}

function samePath(left: readonly ListPathNode[], right: readonly ListPathNode[]): boolean {
	return left.length === right.length && left.every((node, index) => {
		const candidate = right[index];
		return candidate !== undefined && node.name === candidate.name &&
			node.from === candidate.from && node.to === candidate.to;
	});
}

function spanPaths(state: EditorState, range: SourceRange): readonly (readonly ListPathNode[])[] {
	if (range.from === range.to) {
		return [listPathAt(state, range.from, -1), listPathAt(state, range.from, 1)];
	}
	return [listPathAt(state, range.from, 1), listPathAt(state, range.to, -1)];
}

function syntaxForSpan(state: EditorState, range: SourceRange): SpanSyntax {
	const paths = spanPaths(state, range);
	const populated = paths.filter((path) => path.length > 0);
	if (populated.length === 0) return { kind: 'outside' };
	if (populated.length !== paths.length) return { kind: 'ambiguous' };
	const first = populated[0];
	if (!first || !populated.every((path) => samePath(first, path))) return { kind: 'ambiguous' };
	return { kind: 'list', path: first };
}

function mapRange(transaction: Transaction, range: SourceRange): SourceRange {
	return {
		from: transaction.changes.mapPos(range.from, 1),
		to: transaction.changes.mapPos(range.to, -1),
	};
}

function mapContainingRange(transaction: Transaction, range: SourceRange): SourceRange {
	return {
		from: transaction.changes.mapPos(range.from, -1),
		to: transaction.changes.mapPos(range.to, 1),
	};
}

function mappedPath(
	transaction: Transaction,
	path: readonly ListPathNode[],
): readonly ListPathNode[] {
	return path.map((node) => ({ ...mapRange(transaction, node), name: node.name }));
}

function outerEnvelope(path: readonly ListPathNode[]): SourceRange | null {
	const outer = path.find((node) => node.name === 'BulletList' || node.name === 'OrderedList');
	return outer ? { from: outer.from, to: outer.to } : null;
}

function matchingEnvelope(
	transaction: Transaction,
	oldPath: readonly ListPathNode[],
	newPath: readonly ListPathNode[],
): SourceRange | null {
	if (!samePath(mappedPath(transaction, oldPath), newPath)) return null;
	const oldEnvelope = outerEnvelope(oldPath);
	const newEnvelope = outerEnvelope(newPath);
	if (!oldEnvelope || !newEnvelope) return null;
	const mappedEnvelope = mapRange(transaction, oldEnvelope);
	return mappedEnvelope.from === newEnvelope.from && mappedEnvelope.to === newEnvelope.to
		? newEnvelope
		: null;
}

function compareSpanSyntax(
	transaction: Transaction,
	span: ChangedSpan,
): { readonly kind: 'ambiguous' | 'outside' | 'range'; readonly range?: SourceRange } {
	const oldSyntax = syntaxForSpan(transaction.startState, span.oldRange);
	const newSyntax = syntaxForSpan(transaction.state, span.newRange);
	if (oldSyntax.kind === 'outside' && newSyntax.kind === 'outside') return { kind: 'outside' };
	if (oldSyntax.kind !== 'list' || newSyntax.kind !== 'list') return { kind: 'ambiguous' };
	const envelope = matchingEnvelope(transaction, oldSyntax.path, newSyntax.path);
	return envelope ? { kind: 'range', range: envelope } : { kind: 'ambiguous' };
}

function mergeRanges(ranges: readonly SourceRange[]): readonly SourceRange[] {
	const sorted = [...ranges].sort((left, right) => left.from - right.from || left.to - right.to);
	const merged: SourceRange[] = [];
	for (const range of sorted) {
		const previous = merged.at(-1);
		if (!previous || previous.to < range.from) {
			merged.push({ ...range });
		} else {
			merged[merged.length - 1] = { from: previous.from, to: Math.max(previous.to, range.to) };
		}
	}
	return merged;
}

function classifySyntaxInvalidation(
	transaction: Transaction,
	spans: readonly ChangedSpan[],
): ProjectionInvalidation {
	const ranges: SourceRange[] = [];
	for (const span of spans) {
		const comparison = compareSpanSyntax(transaction, span);
		if (comparison.kind === 'ambiguous') return { kind: 'rebuild-all' };
		if (comparison.kind === 'range' && comparison.range) ranges.push(comparison.range);
	}
	return ranges.length === 0
		? { kind: 'map-only' }
		: { kind: 'rebuild-ranges', ranges: mergeRanges(ranges) };
}

function entryForContext(
	context: ReturnType<typeof buildProjectionContexts>[number],
): ProjectionEntry {
	const marker = markerForProjection(context, prefixPolicy);
	const outerMarker = context.block.prefix.outerMarker;
	const markerEnd = outerMarker.to - context.block.prefix.separatorText.length;
	return {
		collapsedSeparator: null,
		blankRuns: context.blankRuns,
		item: { ...context.block.item },
		marker,
		ownedLines: context.ownedLines.map((line) => ({
			...line,
			prefix: { ...line.prefix },
			range: { ...line.range },
		})),
		prefix: { from: context.block.lineFrom, to: context.block.prefix.full.to },
		replacement: {
			from: markerEnd - context.block.prefix.markerText.length,
			to: markerEnd,
		},
		taskToken: context.block.prefix.taskToken
			? { ...context.block.prefix.taskToken }
			: null,
		widget: new StructuredListMarkerWidget(marker),
	};
}

function projectionAuthority(
	state: EditorState,
	entries: readonly ProjectionEntry[],
): ProjectionAuthority {
	recordProjectionWork(state, 'authority');
	return {
		envelopes: completeListEnvelopes(state),
		items: entries.map(({ item, marker, ownedLines, prefix, replacement, taskToken, blankRuns }) => ({
			blankRuns,
			item,
			marker,
			ownedLines,
			prefix,
			replacement,
			taskToken,
		})),
		syntax: projectionSyntaxAuthority(state),
	};
}

function projectionSyntaxAuthority(state: EditorState): ProjectionSyntaxAuthority {
	const tree = syntaxTree(state);
	return {
		complete: syntaxTreeAvailable(state, state.doc.length),
		parsedTo: tree.length,
		tree,
	};
}

function sameSyntaxAuthority(
	left: ProjectionSyntaxAuthority,
	right: ProjectionSyntaxAuthority,
): boolean {
	return left.tree === right.tree &&
		left.parsedTo === right.parsedTo &&
		left.complete === right.complete;
}

function syntaxAuthorityCompletesDocument(
	authority: ProjectionSyntaxAuthority,
	documentLength: number,
): boolean {
	return authority.complete && authority.parsedTo === documentLength;
}

export function projectionEntries(
	state: EditorState,
	within?: readonly SourceRange[],
	ownsLine: (lineFrom: number) => boolean = () => true,
): readonly ProjectionEntry[] {
	const mapped = state.facet(containerListProjections).flatMap(provider => provider(state));
	const mappedLines = new Set(mapped.map(entry => entry.prefix.from));
	const items = enumerateProjectionItems(state, within).filter(item => {
		const lineFrom = state.doc.lineAt(item.itemNode.from).from;
		return !mappedLines.has(lineFrom) && ownsLine(lineFrom);
	});
	return validatedEntries(state, projectionContexts(state, items).map(entryForContext));
}

function projectionAnalysis(state: EditorState): ProjectionAnalysis {
	const entries = projectionEntries(state);
	return { authority: projectionAuthority(state, entries), entries };
}

function mapAuthority(
	transaction: Transaction,
	authority: ProjectionAuthority,
	mappedSyntax: ProjectionSyntaxAuthority = authority.syntax,
): ProjectionAuthority {
	return {
		envelopes: authority.envelopes.map((envelope) => ({
			...mapRange(transaction, envelope),
			name: envelope.name,
		})),
		items: authority.items.map((item) => ({
			blankRuns: item.blankRuns && mapListBlankRuns(item.blankRuns,at=>transaction.changes.mapPos(at)),
			item: mapRange(transaction, item.item),
			marker: item.marker,
			ownedLines: item.ownedLines.map((line) => ({
				...line,
				prefix: mapRange(transaction, line.prefix),
				range: mapRange(transaction, line.range),
			})),
			prefix: mapRange(transaction, item.prefix),
			replacement: mapRange(transaction, item.replacement),
			taskToken: item.taskToken ? mapRange(transaction, item.taskToken) : null,
		})),
		syntax: mappedSyntax,
	};
}

function sameRange(left: SourceRange, right: SourceRange): boolean {
	return left.from === right.from && left.to === right.to;
}

function pairwiseEqual<T>(
	left: readonly T[],
	right: readonly T[],
	equal: (leftValue: T, rightValue: T) => boolean,
): boolean {
	return left.length === right.length && left.every((value, index) => {
		const candidate = right[index];
		return candidate !== undefined && equal(value, candidate);
	});
}

function sameEnvelope(left: ListEnvelope, right: ListEnvelope): boolean {
	return left.name === right.name && sameRange(left, right);
}

function sameMarker(left: StructuredListMarker, right: StructuredListMarker): boolean {
	const leftFacts = [left.depth, left.kind, left.label, left.shape];
	const rightFacts = [right.depth, right.kind, right.label, right.shape];
	return leftFacts.every((value, index) => value === rightFacts[index]);
}

function sameBlankRuns(left: readonly ListBlankRun[] = [], right: readonly ListBlankRun[] = []): boolean {
	return pairwiseEqual(left,right,(a,b)=>sameRange(a.range,b.range) &&
		pairwiseEqual(a.rows,b.rows,(x,y)=>x.at===y.at && x.kind===y.kind) &&
		pairwiseEqual(a.editableBodies,b.editableBodies,sameRange) &&
		pairwiseEqual(a.transparentRanges,b.transparentRanges,sameRange));
}

function sameAuthorityItem(
	left: ProjectionAuthorityItem,
	right: ProjectionAuthorityItem,
): boolean {
	if (!sameBlankRuns(left.blankRuns,right.blankRuns)) return false;
	const leftRanges = [left.item, left.prefix, left.replacement];
	const rightRanges = [right.item, right.prefix, right.replacement];
	return pairwiseEqual(leftRanges, rightRanges, sameRange) && sameMarker(left.marker, right.marker) &&
		(left.taskToken === null
			? right.taskToken === null
			: right.taskToken !== null && sameRange(left.taskToken, right.taskToken)) &&
		pairwiseEqual(left.ownedLines, right.ownedLines, (leftLine, rightLine) =>
			leftLine.depth === rightLine.depth &&
			leftLine.kind === rightLine.kind &&
			leftLine.ownerKind === rightLine.ownerKind &&
			leftLine.rendering === rightLine.rendering &&
			sameRange(leftLine.prefix, rightLine.prefix) &&
			sameRange(leftLine.range, rightLine.range));
}

function mapOnlyAuthorityAgrees(
	transaction: Transaction,
	oldAuthority: ProjectionAuthority,
	newAuthority: ProjectionAuthority,
): boolean {
	const mappedOld = mapAuthority(transaction, oldAuthority);
	return pairwiseEqual(mappedOld.envelopes, newAuthority.envelopes, sameEnvelope) &&
		pairwiseEqual(mappedOld.items, newAuthority.items, sameAuthorityItem);
}

function topLevelBlockAt(
	state: EditorState,
	position: number,
	side: -1 | 1,
): SyntaxNode | null {
	let node = syntaxTree(state).resolve(position, side);
	while (node.parent?.parent) node = node.parent;
	return node.parent ? node : null;
}

function blocksAroundSpan(state: EditorState, range: SourceRange): readonly SyntaxNode[] {
	const positions = range.from === range.to
		? [[range.from, -1], [range.from, 1]] as const
		: [
			[range.from, -1],
			[range.from, 1],
			[range.to, -1],
			[range.to, 1],
		] as const;
	const blocks = new Map<string, SyntaxNode>();
	for (const [position, side] of positions) {
		const block = topLevelBlockAt(state, position, side);
		if (block) blocks.set(`${block.from}:${block.to}:${block.name}`, block);
	}
	return [...blocks.values()].sort((left, right) => left.from - right.from || left.to - right.to);
}

function appendSyntaxFingerprint(node: SyntaxNode, fingerprint: SyntaxFingerprintNode[]): void {
	fingerprint.push({ from: node.from, name: node.name, to: node.to });
	for (let child = node.firstChild; child; child = child.nextSibling) {
		appendSyntaxFingerprint(child, fingerprint);
	}
}

function syntaxFingerprint(block: SyntaxNode): readonly SyntaxFingerprintNode[] {
	const fingerprint: SyntaxFingerprintNode[] = [];
	appendSyntaxFingerprint(block, fingerprint);
	return fingerprint;
}

function sameSyntaxFingerprint(
	transaction: Transaction,
	oldBlock: SyntaxNode,
	newBlock: SyntaxNode,
): boolean {
	if (oldBlock.name !== newBlock.name ||
		!sameRange(mapContainingRange(transaction, oldBlock), newBlock)) return false;
	const oldFingerprint = syntaxFingerprint(oldBlock).map((node) => ({
		...mapContainingRange(transaction, node),
		name: node.name,
	}));
	return pairwiseEqual(oldFingerprint, syntaxFingerprint(newBlock), (left, right) =>
		left.name === right.name && sameRange(left, right));
}

function spanHasStableBlockFingerprint(transaction: Transaction, span: ChangedSpan): boolean {
	const oldBlocks = blocksAroundSpan(transaction.startState, span.oldRange);
	const newBlocks = blocksAroundSpan(transaction.state, span.newRange);
	if (oldBlocks.length === 0 || newBlocks.length === 0) return false;
	if (oldBlocks.some((block) => isListEnvelopeName(block.name)) ||
		newBlocks.some((block) => isListEnvelopeName(block.name))) return false;
	return pairwiseEqual(oldBlocks, newBlocks, (oldBlock, newBlock) =>
		sameSyntaxFingerprint(transaction, oldBlock, newBlock));
}

function changeCanAlterEnvelope(change: SourceRange, envelope: SourceRange): boolean {
	if (change.from === change.to) {
		return envelope.from <= change.from && change.from <= envelope.to;
	}
	return change.from <= envelope.to && envelope.from <= change.to;
}

function cachedAuthoritySupportsBoundedMap(
	transaction: Transaction,
	authority: ProjectionAuthority,
): boolean {
	const spans = changedSpans(transaction);
	const mappedEnvelopes = authority.envelopes.map((envelope) => mapRange(transaction, envelope));
	return spans.every((span) =>
		!authority.envelopes.some((envelope) => changeCanAlterEnvelope(span.oldRange, envelope)) &&
		!mappedEnvelopes.some((envelope) => changeCanAlterEnvelope(span.newRange, envelope)) &&
		spanHasStableBlockFingerprint(transaction, span));
}

function localProjectionInvalidation(
	transaction: Transaction,
): ProjectionInvalidation {
	if (!transaction.docChanged) return { kind: 'map-only' };
	if (transaction.annotation(structuralEditAnnotation) !== undefined) return { kind: 'rebuild-all' };
	const spans = changedSpans(transaction);
	if (spans.some((span) => changedTextHasNewline(transaction, span))) return { kind: 'rebuild-all' };
	if (hasPrefixBoundaryChange(transaction, spans)) return { kind: 'rebuild-all' };
	return classifySyntaxInvalidation(transaction, spans);
}

function classifyNonDocumentProjectionUpdate(
	transaction: Transaction,
	cachedOldAuthority: ProjectionAuthority | null,
	invalidation: ProjectionInvalidation,
): ProjectionUpdateDecision {
	if (transaction.startState.field(emptyBodyState, false) !== transaction.state.field(emptyBodyState, false) ||
		transaction.startState.field(createdBodyOwnershipState, false) !== transaction.state.field(createdBodyOwnershipState, false)) {
		return { analysis: projectionAnalysis(transaction.state), invalidation: { kind: 'rebuild-all' } };
	}
	if (!cachedOldAuthority) return { analysis: null, invalidation };
	const currentSyntax = projectionSyntaxAuthority(transaction.state);
	if (sameSyntaxAuthority(cachedOldAuthority.syntax, currentSyntax)) {
		return { analysis: null, invalidation };
	}
	return {
		analysis: projectionAnalysis(transaction.state),
		invalidation: { kind: 'rebuild-all' },
	};
}

function classifyCachedDocumentMap(
	transaction: Transaction,
	cachedOldAuthority: ProjectionAuthority,
	invalidation: ProjectionInvalidation,
): ProjectionUpdateDecision {
	const mappedSyntax = projectionSyntaxAuthority(transaction.state);
	if (syntaxAuthorityCompletesDocument(
		cachedOldAuthority.syntax,
		transaction.startState.doc.length,
	) && syntaxAuthorityCompletesDocument(
		mappedSyntax,
		transaction.state.doc.length,
	) && cachedAuthoritySupportsBoundedMap(transaction, cachedOldAuthority)) {
		return { analysis: null, invalidation, mappedSyntax };
	}
	return {
		analysis: projectionAnalysis(transaction.state),
		invalidation: { kind: 'rebuild-all' },
	};
}

function classifyProjectionUpdate(
	transaction: Transaction,
	cachedOldAuthority: ProjectionAuthority | null,
): ProjectionUpdateDecision {
	const invalidation = localProjectionInvalidation(transaction);
	if (!transaction.docChanged) {
		return classifyNonDocumentProjectionUpdate(
			transaction,
			cachedOldAuthority,
			invalidation,
		);
	}
	if (invalidation.kind !== 'map-only') {
		return { analysis: null, invalidation };
	}
	if (cachedOldAuthority) {
		return classifyCachedDocumentMap(transaction, cachedOldAuthority, invalidation);
	}
	const oldAuthority = projectionAnalysis(transaction.startState).authority;
	const analysis = projectionAnalysis(transaction.state);
	return {
		analysis,
		invalidation: mapOnlyAuthorityAgrees(transaction, oldAuthority, analysis.authority)
			? invalidation
			: { kind: 'rebuild-all' },
	};
}

export function classifyProjectionInvalidation(
	transaction: Transaction,
): ProjectionInvalidation {
	const cached = publicProjectionInvalidations.get(transaction);
	if (cached) return cached;
	const field = transaction.startState.field(structuredListProjectionField, false);
	if (!field) {
		const invalidation = classifyProjectionUpdate(transaction, null).invalidation;
		publicProjectionInvalidations.set(transaction, invalidation);
		return invalidation;
	}
	transaction.state.field(structuredListProjectionField, false);
	const fieldDecision = projectionFieldUpdateDecisions.get(transaction);
	const invalidation = fieldDecision === inactiveProjectionUpdate
		? classifyProjectionUpdate(transaction, null).invalidation
		: fieldDecision?.invalidation ?? { kind: 'rebuild-all' };
	publicProjectionInvalidations.set(transaction, invalidation);
	return invalidation;
}

export function validateProjectionOwnedLineRange(
	state: EditorState,
	ownerItem: SourceRange,
	range: SourceRange,
): void {
	if (range.from < 0 || range.from > range.to) {
		throw new Error('Invalid projection-owned line range');
	}
	if (range.to > state.doc.length) {
		throw new Error('Projection-owned line range is outside the editor document');
	}
	if (range.from < ownerItem.from || range.to > ownerItem.to) {
		throw new Error('Projection-owned line must remain inside its owner item');
	}
	const physicalLine = state.doc.lineAt(range.from);
	if (physicalLine.from !== range.from) {
		throw new Error('Projection-owned line must start at a physical source line boundary');
	}
	if (physicalLine.to !== range.to) {
		throw new Error('Projection-owned line must cover one complete physical source line');
	}
}

function validateOwnedLine(
	state: EditorState,
	entry: ProjectionEntry,
	line: ProjectionOwnedLine,
	ownedLineStarts: Set<number>,
): void {
	validateProjectionOwnedLineRange(state, entry.item, line.range);
	if (ownedLineStarts.has(line.range.from)) {
		throw new Error('Duplicate projection-owned physical line start');
	}
	ownedLineStarts.add(line.range.from);
}

function validateTaskToken(entry: ProjectionEntry): void {
	if ((entry.marker.kind === 'task') !== (entry.taskToken !== null)) {
		throw new Error('Task projection must retain exactly one task token');
	}
	if (!entry.taskToken) return;
	if (entry.taskToken.from < entry.prefix.from ||
		entry.taskToken.from >= entry.taskToken.to ||
		entry.taskToken.to > entry.prefix.to) {
		throw new Error('Task token must remain inside its protected prefix');
	}
}

function validateEntry(
	state: EditorState,
	entry: ProjectionEntry,
	previous: ProjectionEntry | undefined,
	ownedLineStarts: Set<number>,
): void {
	if (entry.prefix.from >= entry.prefix.to) throw new Error('Invalid prefix projection range');
	if (previous && entry.prefix.from < previous.prefix.to) {
		throw new Error('Duplicate or overlapping prefix projection ranges');
	}
	if (entry.replacement.from < entry.prefix.from || entry.replacement.to > entry.prefix.to) {
		throw new Error('Marker replacement must remain inside its protected prefix');
	}
	validateTaskToken(entry);
	for (const line of entry.ownedLines) {
		validateOwnedLine(state, entry, line, ownedLineStarts);
	}
}

function validatedEntries(
	state: EditorState,
	entries: readonly ProjectionEntry[],
): readonly ProjectionEntry[] {
	const sorted = [...entries].sort((left, right) => left.prefix.from - right.prefix.from);
	const ownedLineStarts = new Set<number>();
	for (let index = 0; index < sorted.length; index += 1) {
		const entry = sorted[index];
		if (!entry) throw new Error('Projection entry vanished during validation');
		validateEntry(state, entry, sorted[index - 1], ownedLineStarts);
	}
	return Object.freeze(sorted);
}

function ownedLineClass(line: ProjectionOwnedLine, emptyBody: boolean, orderedTask: boolean): string {
	const kind = emptyBody ? 'paraflow-list-continuation-line' : line.kind === 'blank'
		? 'paraflow-list-owned-blank-line'
		: `paraflow-list-${line.kind}-line`;
	const rendering = line.rendering === 'projected'
		? `paraflow-list-owned-line-${line.depth + 1}`
		: 'paraflow-list-owned-line--native-depth';
	return [
		'paraflow-list-owned-line',
		kind,
		`paraflow-list-owned-line--${line.ownerKind}`,
		...(orderedTask ? ['paraflow-list-owned-line--ordered-task'] : []),
		rendering,
	].join(' ');
}

function emptyBodyLine(_entry: ProjectionEntry, line: ProjectionOwnedLine): boolean {
	return line.rendering === 'projected' && line.kind !== 'blank' &&
		line.prefix.to === line.range.to && line.prefix.from < line.prefix.to;
}

function sentinelDecorations(entry: ProjectionEntry) {
	const from = entry.taskToken?.to ?? entry.replacement.to + 1;
	return from < entry.prefix.to ? [Decoration.replace({}).range(from, entry.prefix.to)] : [];
}

function markerLineDecorations(entry: ProjectionEntry): Range<Decoration>[] {
	const projectedDepth = entry.marker.depth < 6;
	const orderedTask = entry.marker.kind === 'task' && entry.marker.label !== null;
	if (!projectedDepth && !orderedTask) return [];
	const classes = [];
	if (projectedDepth) classes.push('paraflow-list-marker-line');
	if (orderedTask) classes.push('paraflow-list-owned-line--ordered-task');
	return [Decoration.line({ attributes: {
		class: classes.join(' '),
		...(projectedDepth ? { style: `--paraflow-list-depth:${entry.marker.depth}` } : {}),
	} }).range(entry.prefix.from)];
}

export function decorationsFor(entries: readonly ProjectionEntry[]): DecorationSet {
	const blankRows = new Map(listBlankRuns(entries).flatMap(run => run.rows.map(row => [row.at, row.kind] as const)));
	const ownedLines = entries.flatMap(entry => entry.ownedLines);
	const bodySeparators = new Set(ownedLines.filter(line => line.createdBody).flatMap(body =>
		ownedLines.filter(line => line.range.to + 1 === body.range.from && line.prefix.to === line.range.to && !line.createdBody)
			.map(line => line.range.from)));
	const ownedStarts = new Set(entries.flatMap(entry=>entry.ownedLines.map(line=>line.range.from)));
	const ranges = entries.flatMap((entry) => [
		...markerLineDecorations(entry),
		...(entry.taskToken
			? []
			: [Decoration.replace({ widget: entry.widget }).range(
				entry.replacement.from,
				entry.replacement.to,
			)]),
		...(!entry.taskToken && entry.replacement.to < entry.prefix.to
			? [Decoration.replace({ widget: new StructuredListSeparatorWidget() }).range(
				entry.replacement.to, entry.replacement.to + 1,
			)] : []),
		...sentinelDecorations(entry),
		...(entry.collapsedSeparator
			? [Decoration.replace({}).range(
				entry.collapsedSeparator.from,
				entry.collapsedSeparator.to,
			)]
			: []),
		...entry.ownedLines.map((line) =>
			Decoration.line({ attributes: { class: bodySeparators.has(line.range.from) ? 'paraflow-list-body-separator' : ownedLineClass(line, emptyBodyLine(entry, line), entry.marker.kind === 'task' && entry.marker.label !== null) +
				(emptyBodyLine(entry, line) ? ' paraflow-list-empty-body-line' : '') +
				((line.kind === 'blank' || !line.createdBody) && blankRows.has(line.range.from) ? `${line.kind === 'blank' ? '' : ' paraflow-list-owned-blank-line'} paraflow-list-blank-${blankRows.get(line.range.from)!}` : '') } }).range(line.range.from)),
		...entry.ownedLines.filter(line => emptyBodyLine(entry, line) && !bodySeparators.has(line.range.from)).map(line =>
			Decoration.replace({ widget: new StructuredListEmptyBodyWidget() }).range(line.prefix.from, line.prefix.to)),
		...entry.ownedLines.flatMap((line) => line.rendering === 'projected' && !emptyBodyLine(entry, line) && line.prefix.from < line.prefix.to
			? [Decoration.replace({}).range(line.prefix.from, line.prefix.to)]
			: []),
	]);
	for (const [at,kind] of blankRows) if (!ownedStarts.has(at)) {
		ranges.push(Decoration.line({attributes:{class:`paraflow-list-owned-blank-line paraflow-list-blank-${kind}`}}).range(at));
	}
	return Decoration.set(ranges, true);
}

function taskPrefixDecorations(view: EditorView, active: boolean): DecorationSet {
	if (!active) return Decoration.none;
	const projection = view.state.field(structuredListProjectionField, false);
	if (!projection?.active) return Decoration.none;
	return taskDecorationsFor(view.state, projection.entries);
}

export function taskDecorationsFor(state: EditorState, entries: readonly ProjectionEntry[]): DecorationSet {
	return Decoration.set(entries.flatMap((entry) => {
		const token = entry.taskToken;
		if (!token) return [];
		const tokenSource = state.doc.sliceString(token.from, token.to);
		const tokenMatch = /^\[([ xX])\]([ \t]+)$/u.exec(tokenSource);
		if (!tokenMatch) throw new Error('Projected task token must include its content separator');
		return [
			Decoration.replace({
				widget: new TaskPrefixWidget(
					entry.marker,
					state.doc.sliceString(entry.replacement.to, token.from),
					tokenMatch[1]!.toLowerCase() === 'x',
					tokenMatch[2]!,
					token.from,
				),
			}).range(entry.replacement.from, token.to),
		];
	}), true);
}

function createTaskPrefixProjection(isActive: (view: EditorView) => boolean): Extension {
	return Prec.highest(ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		private active: boolean;

		constructor(readonly view: EditorView) {
			this.active = isActive(view);
			this.decorations = taskPrefixDecorations(view, this.active);
		}

		update(update: ViewUpdate): void {
			const active = isActive(this.view);
			if (!update.docChanged &&
				getStructuredListProjectionState(update.startState) ===
					getStructuredListProjectionState(update.state) &&
				active === this.active) return;
			this.active = active;
			this.decorations = taskPrefixDecorations(this.view, active);
		}
	}, {
		decorations: (value) => value.decorations,
	}));
}

function createTaskContentCaret(isActive: (view: EditorView) => boolean): Extension {
	return ViewPlugin.fromClass(class {
		private readonly caret: HTMLElement;
		private readonly onScroll = (): void => this.schedule();

		constructor(readonly view: EditorView) {
			this.caret = createDetachedEl(view.dom.ownerDocument, 'span');
			this.caret.className = 'paraflow-task-content-caret';
			this.caret.setAttribute('aria-hidden', 'true');
			view.dom.append(this.caret);
			view.scrollDOM.addEventListener('scroll', this.onScroll);
			this.schedule();
		}

		update(update: ViewUpdate): void {
			if (update.selectionSet || update.docChanged || update.focusChanged ||
				update.viewportChanged || update.geometryChanged) this.schedule();
		}

		private schedule(): void {
			this.view.requestMeasure({
				read: () => {
					const selection = this.view.state.selection;
					const head = selection.main.head;
					if (!isActive(this.view) || !this.view.hasFocus ||
						selection.ranges.length !== 1 || !selection.main.empty ||
						!getStructuredListTaskTokens(this.view.state).some((token) => token.to === head)) {
						return null;
					}
					const position = this.view.coordsAtPos(head);
					if (!position) return null;
					const editor = this.view.dom.getBoundingClientRect();
					return {
						height: position.bottom - position.top,
						left: position.left - editor.left,
						top: position.top - editor.top,
					};
				},
				write: (position) => {
					const visible = position !== null && position.height > 0;
					this.view.dom.classList.toggle('paraflow-task-content-caret-active', visible);
					if (!visible) return;
					this.caret.style.height = `${position.height}px`;
					this.caret.style.left = `${position.left}px`;
					this.caret.style.top = `${position.top}px`;
				},
			});
		}

		destroy(): void {
			this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
			this.view.dom.classList.remove('paraflow-task-content-caret-active');
			this.caret.remove();
		}
	});
}

function rangeIndexFor(entries: readonly ProjectionEntry[]): StructuredListRangeIndex {
	const protectedRanges = Object.freeze(entries.flatMap((entry) => [
		entry.prefix,
		...entry.ownedLines.filter((line) => line.prefix.from < line.prefix.to)
			.map((line) => line.prefix),
	]).sort((left, right) => left.from - right.from).map((range) => Object.freeze({ ...range })));
	const containing = (position: number): SourceRange | null =>
		protectedRanges.find((range) => range.from < position && position < range.to) ?? null;
	return Object.freeze({
		containing,
		mapEndpoint: (position: number, bias: -1 | 1): number => {
			const range = containing(position);
			if (!range) return position;
			return bias < 0 ? range.from : range.to;
		},
		protectedRanges,
	});
}

function stateFromProjection(
	entries: readonly ProjectionEntry[],
	authority: ProjectionAuthority | null,
	active: boolean,
): ProjectionFieldState {
	const decorations = decorationsFor(entries);
	const rangeIndex = rangeIndexFor(entries);
	const atomicRanges = RangeSet.of(rangeIndex.protectedRanges.map((range) =>
		prefixRangeValue.range(range.from, range.to)));
	return Object.freeze({
		active,
		atomicRanges,
		authority,
		decorations,
		entries,
		rangeIndex,
	});
}

function stateFromAnalysis(analysis: ProjectionAnalysis): ProjectionFieldState {
	return stateFromProjection(analysis.entries, analysis.authority, true);
}

function emptyProjection(): ProjectionFieldState {
	return stateFromProjection([], null, false);
}

function livePreviewEnabled(state: EditorState): boolean {
	const predicates = state.facet(livePreviewPredicates);
	return predicates.length === 1 && predicates[0]?.(state) === true;
}

function mapEntry(transaction: Transaction, entry: ProjectionEntry): ProjectionEntry {
	return {
		blankRuns: entry.blankRuns && mapListBlankRuns(entry.blankRuns,at=>transaction.changes.mapPos(at)),
		collapsedSeparator: entry.collapsedSeparator
			? mapRange(transaction, entry.collapsedSeparator)
			: null,
		item: mapRange(transaction, entry.item),
		marker: entry.marker,
		ownedLines: entry.ownedLines.map((line) => ({
			...line,
			prefix: mapRange(transaction, line.prefix),
			range: mapRange(transaction, line.range),
		})),
		prefix: mapRange(transaction, entry.prefix),
		replacement: mapRange(transaction, entry.replacement),
		taskToken: entry.taskToken ? mapRange(transaction, entry.taskToken) : null,
		widget: entry.widget,
	};
}

function intersectsAny(range: SourceRange, regions: readonly SourceRange[]): boolean {
	return regions.some((region) => range.from < region.to && region.from < range.to);
}

function rebuildAll(state: EditorState): ProjectionFieldState {
	return stateFromAnalysis(projectionAnalysis(state));
}

function rebuildRanges(
	value: ProjectionFieldState,
	transaction: Transaction,
	ranges: readonly SourceRange[],
): ProjectionFieldState {
	const mapped = value.entries.map((entry) => mapEntry(transaction, entry));
	const unaffected = mapped.filter((entry) => !intersectsAny(entry.prefix, ranges));
	const rebuilt = projectionEntries(transaction.state, ranges);
	const entries = validatedEntries(transaction.state, [...unaffected, ...rebuilt]);
	const authority = projectionAuthority(transaction.state, entries);
	return stateFromProjection(entries, authority, true);
}

function createProjectionState(state: EditorState): ProjectionFieldState {
	return livePreviewEnabled(state) ? rebuildAll(state) : emptyProjection();
}

function mapOnlyProjectionState(
	value: ProjectionFieldState,
	transaction: Transaction,
	analysis: ProjectionAnalysis | null,
	mappedSyntax?: ProjectionSyntaxAuthority,
): ProjectionFieldState {
	const entries = validatedEntries(
		transaction.state,
		value.entries.map((entry) => mapEntry(transaction, entry)),
	);
	if (analysis) return stateFromProjection(entries, analysis.authority, true);
	if (!value.authority) return rebuildAll(transaction.state);
	return stateFromProjection(
		entries,
		mapAuthority(transaction, value.authority, mappedSyntax),
		true,
	);
}

function canReuseProjectionState(
	value: ProjectionFieldState,
	transaction: Transaction,
	decision: ProjectionUpdateDecision,
): boolean {
	return !transaction.docChanged &&
		value.authority !== null &&
		decision.analysis === null &&
		decision.invalidation.kind === 'map-only' &&
		decision.mappedSyntax === undefined;
}

function applyProjectionDecision(
	value: ProjectionFieldState,
	transaction: Transaction,
	decision: ProjectionUpdateDecision,
): ProjectionFieldState {
	if (canReuseProjectionState(value, transaction, decision)) return value;
	if (decision.invalidation.kind === 'rebuild-all') {
		return decision.analysis ? stateFromAnalysis(decision.analysis) : rebuildAll(transaction.state);
	}
	if (decision.invalidation.kind === 'rebuild-ranges') {
		return rebuildRanges(value, transaction, decision.invalidation.ranges);
	}
	return mapOnlyProjectionState(
		value,
		transaction,
		decision.analysis,
		decision.mappedSyntax,
	);
}

function updateProjectionState(
	value: ProjectionFieldState,
	transaction: Transaction,
): ProjectionFieldState {
	const active = livePreviewEnabled(transaction.state);
	if (!active) {
		projectionFieldUpdateDecisions.set(transaction, inactiveProjectionUpdate);
		return emptyProjection();
	}
	if (!value.active) {
		const analysis = projectionAnalysis(transaction.state);
		projectionFieldUpdateDecisions.set(transaction, {
			analysis,
			invalidation: { kind: 'rebuild-all' },
		});
		return stateFromAnalysis(analysis);
	}
	const decision = classifyProjectionUpdate(transaction, value.authority);
	projectionFieldUpdateDecisions.set(transaction, decision);
	return applyProjectionDecision(value, transaction, decision);
}

export const structuredListProjectionField = StateField.define<ProjectionFieldState>({
	create: createProjectionState,
	update: updateProjectionState,
});

function combinedProjection(state: EditorState): ProjectionFieldState | null {
	const ordinary = state.field(structuredListProjectionField, false);
	const providers = state.facet(containerListProjections);
	if (!providers.length) return ordinary ?? null;
	const cached = combinedProjections.get(state);
	if (cached) return cached;
	const entries = validatedEntries(state, [...(ordinary?.entries ?? []), ...providers.flatMap(provider => provider(state))]);
	const result = stateFromProjection(entries, null, true);
	combinedProjections.set(state, result);
	return result;
}

export function getStructuredListProjectionState(state: EditorState): StructuredListProjectionState | null {
	return combinedProjection(state);
}

/** Source prefixes whose ordered numbering is owned by the active list projection. */
export function getStructuredListNumberedPrefixes(state: EditorState): readonly SourceRange[] {
	const projection = combinedProjection(state);
	return projection?.active ? projection.entries.filter(entry => entry.marker.label !== null).map(entry => entry.prefix) : [];
}

/** Source offset of a proven marker inside an active quote projection. */
export function projectedQuoteMarkerOffset(state: EditorState, position: number): number | null {
	const projection = combinedProjection(state);
	if (!projection?.active) return null;
	const line = state.doc.lineAt(position);
	const entry = projection.entries.find(entry => entry.prefix.from === line.from &&
		entry.prefix.to <= position && position <= entry.item.to);
	if (!entry) return null;
	const container = state.sliceDoc(line.from, entry.replacement.from);
	return /^ {0,3}(?:> ?)+/u.exec(container)?.[0].length ?? null;
}

export function getStructuredListTaskTokens(
	state: EditorState,
): readonly StructuredListTaskToken[] {
	const projection = combinedProjection(state);
	if (!projection?.active) return [];
	return projection.entries.flatMap(({ taskToken }) => {
		if (!taskToken) return [];
		return [{
			...taskToken,
			checked: /^\[[xX]\]/u.test(state.doc.sliceString(taskToken.from, taskToken.to)),
		}];
	});
}

export function getStructuredListSelectionTransparentRanges(
	state: EditorState,
): readonly SourceRange[] {
	const projection = combinedProjection(state);
	if (!projection?.active) return [];
	return listBlankRuns(projection.entries).flatMap(run => run.transparentRanges);
}

export function getStructuredListBlankRuns(state: EditorState): readonly ListBlankRun[] {
	const projection = combinedProjection(state);
	return listBlankRuns(projection?.active ? projection.entries : projectionEntries(state));
}

export function createStructuredListProjection(
	options: StructuredListProjectionOptions,
): Extension {
	const isActive = options.isActive ?? (() => true);
	return [
		livePreviewPredicates.of(options.isLivePreview),
		createListEmptyBodyState(),
		structuredListProjectionField,
		emptyVisualLineAnchor.of((state, position) => {
			if (!options.isLivePreview(state)) return null;
			const line = state.doc.lineAt(position);
			const entry = combinedProjection(state)?.entries.find(entry =>
				entry.prefix.from === line.from && entry.prefix.to === line.to);
			return entry ? line.to : null;
		}),
		EditorView.decorations.of((view) => isActive(view)
			? view.state.field(structuredListProjectionField).decorations
			: Decoration.none),
		EditorView.atomicRanges.of((view) => isActive(view)
			? view.state.field(structuredListProjectionField).atomicRanges
			: RangeSet.empty),
		createTaskPrefixProjection(isActive),
		createTaskContentCaret(isActive),
	];
}
