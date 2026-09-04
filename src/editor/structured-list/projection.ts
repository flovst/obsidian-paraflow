import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import {
	Facet,
	RangeSet,
	RangeValue,
	StateField,
	type EditorState,
	type Extension,
	type Transaction,
} from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { buildProjectionContexts } from './context.js';
import { structuralEditAnnotation } from './edit-plan.js';
import {
	markerForProjection,
	StructuredListMarkerWidget,
	type StructuredListMarker,
} from './marker-widget.js';
import type {
	ProjectionInvalidation,
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
}

export interface StructuredListProjectionState {
	readonly decorations: DecorationSet;
	readonly atomicRanges: RangeSet<RangeValue>;
	readonly rangeIndex: StructuredListRangeIndex;
}

export type StructuredListProjectionWork = 'authority' | 'contexts' | 'enumerate';

interface ProjectionEntry extends ProjectionAuthorityItem {
	readonly widget: StructuredListMarkerWidget;
}

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
	readonly item: SourceRange;
	readonly marker: StructuredListMarker;
	readonly prefix: SourceRange;
	readonly replacement: SourceRange;
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
	return {
		item: { ...context.block.item },
		marker,
		prefix: { from: context.block.lineFrom, to: context.block.prefix.full.to },
		replacement: { ...context.block.prefix.outerMarker },
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
		items: entries.map(({ item, marker, prefix, replacement }) => ({
			item,
			marker,
			prefix,
			replacement,
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

function projectionEntries(
	state: EditorState,
	within?: readonly SourceRange[],
): readonly ProjectionEntry[] {
	const items = enumerateProjectionItems(state, within);
	return validatedEntries(projectionContexts(state, items).map(entryForContext));
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
			item: mapRange(transaction, item.item),
			marker: item.marker,
			prefix: mapRange(transaction, item.prefix),
			replacement: mapRange(transaction, item.replacement),
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

function sameAuthorityItem(
	left: ProjectionAuthorityItem,
	right: ProjectionAuthorityItem,
): boolean {
	const leftRanges = [left.item, left.prefix, left.replacement];
	const rightRanges = [right.item, right.prefix, right.replacement];
	return pairwiseEqual(leftRanges, rightRanges, sameRange) && sameMarker(left.marker, right.marker);
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

function validatedEntries(entries: readonly ProjectionEntry[]): readonly ProjectionEntry[] {
	const sorted = [...entries].sort((left, right) => left.prefix.from - right.prefix.from);
	for (let index = 0; index < sorted.length; index += 1) {
		const entry = sorted[index];
		const previous = sorted[index - 1];
		if (!entry || entry.prefix.from >= entry.prefix.to) throw new Error('Invalid prefix projection range');
		if (previous && entry.prefix.from < previous.prefix.to) {
			throw new Error('Duplicate or overlapping prefix projection ranges');
		}
		if (entry.replacement.from < entry.prefix.from || entry.replacement.to > entry.prefix.to) {
			throw new Error('Marker replacement must remain inside its protected prefix');
		}
	}
	return Object.freeze(sorted);
}

function rangeIndexFor(entries: readonly ProjectionEntry[]): StructuredListRangeIndex {
	const protectedRanges = Object.freeze(entries.map((entry) => Object.freeze({ ...entry.prefix })));
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
	const decorations = Decoration.set(entries.map((entry) =>
		Decoration.replace({ widget: entry.widget }).range(entry.replacement.from, entry.replacement.to)));
	const atomicRanges = RangeSet.of(entries.map((entry) =>
		prefixRangeValue.range(entry.prefix.from, entry.prefix.to)));
	return Object.freeze({
		active,
		atomicRanges,
		authority,
		decorations,
		entries,
		rangeIndex: rangeIndexFor(entries),
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
		item: mapRange(transaction, entry.item),
		marker: entry.marker,
		prefix: mapRange(transaction, entry.prefix),
		replacement: mapRange(transaction, entry.replacement),
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
	const entries = validatedEntries([...unaffected, ...rebuilt]);
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
	const entries = validatedEntries(value.entries.map((entry) => mapEntry(transaction, entry)));
	if (analysis) return stateFromProjection(entries, analysis.authority, true);
	if (!value.authority) return rebuildAll(transaction.state);
	return stateFromProjection(
		entries,
		mapAuthority(transaction, value.authority, mappedSyntax),
		true,
	);
}

function applyProjectionDecision(
	value: ProjectionFieldState,
	transaction: Transaction,
	decision: ProjectionUpdateDecision,
): ProjectionFieldState {
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

const projectionDecorations = EditorView.decorations.from(
	structuredListProjectionField,
	(value) => value.decorations,
);

const projectionAtomicRanges = EditorView.atomicRanges.of((view) =>
	view.state.field(structuredListProjectionField).atomicRanges);

export function getStructuredListProjectionState(
	state: EditorState,
): StructuredListProjectionState | null {
	return state.field(structuredListProjectionField, false) ?? null;
}

export function createStructuredListProjection(
	options: StructuredListProjectionOptions,
): Extension {
	return [
		livePreviewPredicates.of(options.isLivePreview),
		structuredListProjectionField,
		projectionDecorations,
		projectionAtomicRanges,
	];
}
