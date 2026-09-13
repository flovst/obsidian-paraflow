import { EditorSelection, type ChangeSpec } from '@codemirror/state';
import type {
	EditPlan,
	EditPlanFragment,
	EditRegionId,
	EditScope,
} from './edit-plan.js';
import type {
	ListContext,
	ListBlockRef,
	NormalizedStructuralBoundary,
	OwnedBlock,
	OrderedSequenceContext,
	SelectionContext,
	SelectionSnapshot,
	SourceRange,
	SourceSnapshot,
	WhitespaceBoundaryFact,
} from './model.js';
import type { HandledOperationId } from './operations.js';

const sameId = (left: EditRegionId, right: EditRegionId): boolean =>
	left.kind === right.kind && left.index === right.index;

const sameRange = (left: SourceRange, right: SourceRange): boolean =>
	left.from === right.from && left.to === right.to;

function regionFor(scope: EditScope, id: EditRegionId, kind: EditRegionId['kind']) {
	if (id.kind !== kind) throw new Error(`Expected a ${kind} region ID`);
	const region = scope.region(id);
	if (!region) throw new Error(`Named ${kind} region is absent from the edit scope`);
	return region;
}

function fragment(
	scope: EditScope,
	regionIds: readonly EditRegionId[],
	changes: readonly ChangeSpec[],
	selection: EditorSelection | null,
): EditPlanFragment {
	return {
		changes,
		operation: scope.operation,
		ownership: { regionIds },
		regionIds,
		selection,
	};
}

function prefixRegion(context: ListContext, id: EditRegionId): void {
	const region = regionFor(context.editScope, id, 'current-prefix');
	if (!sameRange(region.range, context.current.prefix.full)) {
		throw new Error('Current-prefix region does not match normalized context');
	}
}

export function removePrefix(
	context: ListContext,
	prefixRegionId: EditRegionId,
): EditPlanFragment {
	prefixRegion(context, prefixRegionId);
	const { from, to } = context.current.prefix.full;
	return fragment(context.editScope, [prefixRegionId], [{ from, insert: '', to }], null);
}

function idsCoverRange(scope: EditScope, ids: readonly EditRegionId[], target: SourceRange): boolean {
	return ids.some((id) => {
		const candidate = scope.region(id);
		return candidate !== null && candidate.range.from <= target.from && target.to <= candidate.range.to;
	});
}

export function convertItemToParagraph(
	context: ListContext,
	regionIds: readonly EditRegionId[],
): EditPlanFragment {
	const prefix = context.current.prefix.full;
	const physicalPrefix = { from: context.current.lineFrom, to: prefix.to };
	if (!idsCoverRange(context.editScope, regionIds, physicalPrefix)) {
		throw new Error('Named item regions do not cover the normalized current prefix');
	}
	return fragment(context.editScope, regionIds, [
		{ from: physicalPrefix.from, insert: '', to: physicalPrefix.to },
	], null);
}

export function splitItem(
	context: ListContext,
	contentRegionId: EditRegionId,
	splitAt: number,
	linePrefix?: string,
): EditPlanFragment {
	const region = regionFor(context.editScope, contentRegionId, 'current-content');
	if (splitAt < region.range.from || splitAt > region.range.to) {
		throw new RangeError('Split point is outside the current content region');
	}
	const insertion = `\n${linePrefix ?? context.source.slice({
		from: context.current.lineFrom,
		to: context.current.prefix.full.to,
	})}`;
	return fragment(context.editScope, [contentRegionId], [
		{ from: splitAt, insert: insertion, to: splitAt },
	], EditorSelection.create([EditorSelection.cursor(splitAt + insertion.length)]));
}

export function insertContentText(
	context: ListContext,
	contentRegionId: EditRegionId,
	text: string,
): EditPlanFragment {
	const region = regionFor(context.editScope, contentRegionId, 'current-content');
	if (context.caret < region.range.from || context.caret > region.range.to) {
		throw new RangeError('Content insertion point is outside the current content region');
	}
	if (text.length === 0) throw new RangeError('Content insertion text must not be empty');
	return fragment(context.editScope, [contentRegionId], [
		{ from: context.caret, insert: text, to: context.caret },
	], EditorSelection.create([
		EditorSelection.cursor(context.caret + text.length),
	]));
}

export function replaceCurrentPrefix(
	context: ListContext,
	prefixRegionId: EditRegionId,
	replacement: string,
): EditPlanFragment {
	prefixRegion(context, prefixRegionId);
	return fragment(context.editScope, [prefixRegionId], [{
		from: context.current.prefix.full.from,
		insert: replacement,
		to: context.current.prefix.full.to,
	}], null);
}

export function replaceListBlockPrefix(
	source: SourceSnapshot,
	scope: EditScope,
	regionId: EditRegionId,
	block: ListBlockRef,
	replacement: string,
): EditPlanFragment {
	const region = scope.region(regionId);
	const from = block.lineFrom;
	const to = block.prefix.full.to;
	if (!region || region.range.from > from || region.range.to < to) {
		throw new Error('Named list-block region does not cover the normalized prefix');
	}
	if (source.slice({ from: block.prefix.full.from, to }) === '') {
		throw new Error('Normalized list-block prefix is empty');
	}
	return fragment(scope, [regionId], [{ from, insert: replacement, to }], null);
}

export function insertAfterListBlock(
	scope: EditScope,
	regionId: EditRegionId,
	block: ListBlockRef,
	text: string,
): EditPlanFragment {
	const region = regionFor(scope, regionId, 'following-block');
	if (region.range.from !== block.item.to || region.range.to !== block.item.to) {
		throw new Error('Following-block region is not the normalized insertion point');
	}
	if (text.length === 0) throw new RangeError('Following-block insertion text must not be empty');
	return fragment(scope, [regionId], [
		{ from: block.item.to, insert: text, to: block.item.to },
	], null);
}

export function replaceOwnedBlockIndentation(
	context: ListContext,
	ownedRegionId: EditRegionId,
	owned: OwnedBlock,
	replacement: string,
): EditPlanFragment {
	const region = regionFor(context.editScope, ownedRegionId, 'owned-block');
	if (!sameRange(region.range, owned.range)) {
		throw new Error('Owned-block region does not match normalized context');
	}
	const indentationEnd = owned.range.from + owned.indentText.length;
	return fragment(context.editScope, [ownedRegionId], [{
		from: owned.range.from,
		insert: replacement,
		to: indentationEnd,
	}], EditorSelection.create([
		EditorSelection.cursor(owned.range.from + replacement.length),
	]));
}

function emptyItemReplacementRange(
	context: ListContext,
	regionRange: SourceRange,
	replacePhysicalIndent: boolean,
): SourceRange {
	const expectedFrom = replacePhysicalIndent ? context.current.lineFrom : context.current.item.from;
	if (context.current.content.from !== context.current.content.to) {
		throw new Error('Current-item region does not match a normalized empty item');
	}
	if (regionRange.from !== expectedFrom || regionRange.to !== context.current.item.to) {
		throw new Error('Current-item region does not match a normalized empty item');
	}
	return {
		from: replacePhysicalIndent ? context.current.lineFrom : context.current.markerLine.from,
		to: context.current.markerLine.to,
	};
}

function emptyItemOwnedChanges(
	context: ListContext,
	regionRange: SourceRange,
	delta: number,
): readonly ChangeSpec[] {
	if (!Number.isInteger(delta)) throw new RangeError('Owned indentation delta must be an integer');
	if (delta === 0) return [];
	return context.topology.ownedBlocks.flatMap((owned) => {
		if (owned.range.from < regionRange.from || owned.range.to > regionRange.to) {
			throw new Error('Current-item region does not cover a normalized owned block');
		}
		return indentationChanges(context.source, owned.range, delta);
	});
}

export function replaceEmptyItem(
	context: ListContext,
	itemRegionId: EditRegionId,
	replacement: string,
	caretOffset: number,
	options: {
		readonly ownedIndentDelta?: number;
		readonly replacePhysicalIndent?: boolean;
	} = {},
): EditPlanFragment {
	const region = regionFor(context.editScope, itemRegionId, 'current-item');
	const replacementRange = emptyItemReplacementRange(
		context,
		region.range,
		options.replacePhysicalIndent ?? false,
	);
	if (!Number.isInteger(caretOffset) || caretOffset < 0 || caretOffset > replacement.length) {
		throw new RangeError('Empty-item caret offset is outside the replacement');
	}
	const ownedChanges = emptyItemOwnedChanges(
		context,
		region.range,
		options.ownedIndentDelta ?? 0,
	);
	return fragment(context.editScope, [itemRegionId], [{
		from: replacementRange.from,
		insert: replacement,
		to: replacementRange.to,
	}, ...ownedChanges], EditorSelection.create([
		EditorSelection.cursor(replacementRange.from + caretOffset),
	]));
}

function firstOwnedDescendant(context: ListContext): ListContext['topology']['ownedBlocks'][number] {
	const firstOwned = context.topology.ownedBlocks[0];
	if (!firstOwned || !context.topology.ownedBlocks.every((block) => block.kind === 'descendant')) {
		throw new Error('Promoting an empty item requires normalized descendant blocks');
	}
	return firstOwned;
}

function promotedOwnedContentOffset(
	context: ListContext,
	replacementRange: SourceRange,
	ownedIndentDelta: number,
): number {
	const firstOwned = firstOwnedDescendant(context);
	if (replacementRange.to >= context.source.length || context.source.text[replacementRange.to] !== '\n') {
		throw new Error('Empty item before owned blocks must end at a physical newline');
	}
	const firstFollowing = context.topology.followingBoundary;
	if (firstFollowing.kind !== 'list-item' || firstFollowing.block.lineFrom !== firstOwned.range.from) {
		throw new Error('First owned descendant does not match the normalized following list item');
	}
	const offset = firstFollowing.block.content.from - firstFollowing.block.lineFrom + ownedIndentDelta;
	if (!Number.isInteger(offset) || offset < 0) {
		throw new RangeError('Promoted descendant content offset is invalid');
	}
	return offset;
}

export function removeEmptyItemAndPromoteOwnedBlocks(
	context: ListContext,
	itemRegionId: EditRegionId,
	ownedIndentDelta: number,
): EditPlanFragment {
	const region = regionFor(context.editScope, itemRegionId, 'current-item');
	const replacementRange = emptyItemReplacementRange(context, region.range, true);
	const promotedContentOffset = promotedOwnedContentOffset(
		context,
		replacementRange,
		ownedIndentDelta,
	);
	const ownedChanges = emptyItemOwnedChanges(
		context,
		region.range,
		ownedIndentDelta,
	);
	return fragment(context.editScope, [itemRegionId], [{
		from: replacementRange.from,
		insert: '',
		to: replacementRange.to + 1,
	}, ...ownedChanges], EditorSelection.create([
		EditorSelection.cursor(replacementRange.from + promotedContentOffset),
	]));
}

function structuralBoundaryId(
	scope: EditScope,
	boundary: NormalizedStructuralBoundary,
	ids: readonly EditRegionId[],
): EditRegionId {
	const expectedKind = boundary.following.kind === 'terminal-newlines'
		? 'terminal-newlines'
		: 'structural-boundary';
	const id = ids.find((candidate) => candidate.kind === expectedKind);
	if (!id) throw new Error(`A ${expectedKind} region ID is required`);
	const region = regionFor(scope, id, expectedKind);
	if (!sameRange(region.range, boundary.removalRange)) {
		throw new Error('Expected a matching structural-boundary region');
	}
	return id;
}

export function mergeFollowingBlock(
	context: ListContext,
	boundary: NormalizedStructuralBoundary,
	regionIds: readonly EditRegionId[],
): EditPlanFragment {
	structuralBoundaryId(context.editScope, boundary, regionIds);
	return fragment(context.editScope, regionIds, [
		{ from: boundary.removalRange.from, insert: '', to: boundary.removalRange.to },
	], EditorSelection.create([EditorSelection.cursor(boundary.removalRange.from)]));
}

function indentationChanges(
	source: SourceSnapshot,
	range: SourceRange,
	deltaColumns: number,
): readonly ChangeSpec[] {
	const text = source.slice(range);
	const starts = [0];
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] === '\n' && index + 1 < text.length) starts.push(index + 1);
	}
	return starts.flatMap((relativeStart) => {
		const from = range.from + relativeStart;
		if (deltaColumns > 0) return [{ from, insert: ' '.repeat(deltaColumns), to: from }];
		const indentation = /^[ \t]*/u.exec(text.slice(relativeStart))?.[0] ?? '';
		const remove = Math.min(indentation.length, Math.abs(deltaColumns));
		return remove === 0 ? [] : [{ from, insert: '', to: from + remove }];
	});
}

export function remapIndentation(
	source: SourceSnapshot,
	scope: EditScope,
	regionIds: readonly EditRegionId[],
	deltaColumns: number,
): EditPlanFragment {
	if (!Number.isInteger(deltaColumns) || deltaColumns === 0) {
		throw new RangeError('Indentation delta must be a non-zero integer');
	}
	const changes = regionIds.flatMap((id) => {
		const region = scope.region(id);
		if (!region) throw new Error('Indentation region is absent from the edit scope');
		return indentationChanges(source, region.range, deltaColumns);
	});
	return fragment(scope, regionIds, changes, null);
}

function orderedMarker(sequence: OrderedSequenceContext, index: number, delta: number): string {
	const item = sequence.items[index];
	if (!item || item.prefix.orderedValue === null) throw new Error('Ordered region index is not in the sequence');
	const suffix = /^\d+(.*)$/u.exec(item.prefix.markerText)?.[1];
	if (suffix === undefined) throw new Error('Normalized ordered marker has no numeric value');
	return `${sequence.renderedValue + index - sequence.currentIndex + delta}${suffix}${item.prefix.separatorText}`;
}

function assertOuterMarkerSource(source: SourceSnapshot, item: OrderedSequenceContext['items'][number]): void {
	const expected = `${item.prefix.markerText}${item.prefix.separatorText}`;
	if (source.slice(item.prefix.outerMarker) !== expected) {
		throw new Error('Ordered marker does not match the normalized source snapshot');
	}
}

export function renumberOrderedItems(
	source: SourceSnapshot,
	scope: EditScope,
	regionIds: readonly EditRegionId[],
	sequence: OrderedSequenceContext,
	delta = 0,
): EditPlanFragment {
	if (!Number.isInteger(delta)) throw new RangeError('Ordered renumber delta must be an integer');
	const changes = regionIds.map((id): ChangeSpec => {
		const orderedKind = id.kind === 'ordered-sequence-item' ||
			id.kind === 'parent-ordered-sequence-item';
		if (!orderedKind || id.index === null) {
			throw new Error('Renumbering requires indexed ordered-sequence-item regions');
		}
		const item = sequence.items[id.index];
		const region = scope.region(id);
		if (!item || !region || !sameRange(region.range, item.prefix.full)) {
			throw new Error('Ordered region does not match the normalized sequence item');
		}
		assertOuterMarkerSource(source, item);
		return {
			from: item.prefix.outerMarker.from,
			insert: orderedMarker(sequence, id.index, delta),
			to: item.prefix.outerMarker.to,
		};
	});
	return fragment(scope, regionIds, changes, null);
}

function characterRange(text: string, position: number, direction: 'backward' | 'forward'): SourceRange {
	if (direction === 'forward') {
		const point = text.codePointAt(position);
		return { from: position, to: position + (point !== undefined && point > 0xffff ? 2 : 1) };
	}
	const previous = text.charCodeAt(position - 1);
	const startsPair = previous >= 0xdc00 && previous <= 0xdfff && position >= 2;
	return { from: position - (startsPair ? 2 : 1), to: position };
}

export function deleteVisibleCharacter(
	context: ListContext,
	contentRegionId: EditRegionId,
	direction: 'backward' | 'forward',
): EditPlanFragment {
	const region = regionFor(context.editScope, contentRegionId, 'current-content');
	const deletion = characterRange(context.source.text, context.caret, direction);
	if (deletion.from < region.range.from || deletion.to > region.range.to) {
		throw new RangeError('Visible character is outside the current content region');
	}
	return fragment(context.editScope, [contentRegionId], [
		{ from: deletion.from, insert: '', to: deletion.to },
	], EditorSelection.create([EditorSelection.cursor(deletion.from)]));
}

export function rewriteWhitespaceBoundary(
	scope: EditScope,
	boundary: WhitespaceBoundaryFact,
	boundaryRegionId: EditRegionId,
	replacement: string,
): EditPlanFragment {
	const region = regionFor(scope, boundaryRegionId, 'whitespace-boundary');
	if (!sameRange(region.range, boundary.range)) {
		throw new Error('Expected a matching whitespace-boundary region');
	}
	return fragment(scope, [boundaryRegionId], [
		{ from: boundary.range.from, insert: replacement, to: boundary.range.to },
	], null);
}

export function removeStructuralBoundary(
	scope: EditScope,
	boundary: NormalizedStructuralBoundary,
	boundaryRegionId: EditRegionId,
): EditPlanFragment {
	structuralBoundaryId(scope, boundary, [boundaryRegionId]);
	return fragment(scope, [boundaryRegionId], [
		{ from: boundary.removalRange.from, insert: '', to: boundary.removalRange.to },
	], null);
}

function unionRegionIds(fragments: readonly EditPlanFragment[]): readonly EditRegionId[] {
	const ids: EditRegionId[] = [];
	for (const item of fragments) {
		for (const id of item.regionIds) {
			if (!ids.some((candidate) => sameId(candidate, id))) ids.push(id);
		}
	}
	return ids;
}

export function composeEditPlan(
	expectedOperation: HandledOperationId,
	expectedScope: EditScope,
	fragments: readonly EditPlanFragment[],
	exceptionId: EditPlan['exceptionId'] = null,
): EditPlan {
	if (fragments.length === 0) throw new Error('Cannot compose an empty edit plan');
	const incompatible = fragments.some((item) => item.operation !== expectedOperation);
	if (incompatible) throw new Error('Edit fragments have an incompatible operation');
	const selections = fragments.flatMap((item) => item.selection ? [item.selection] : []);
	if (selections.length > 1) throw new Error('Edit fragments contain multiple final selections');
	const regionIds = unionRegionIds(fragments);
	return {
		changes: fragments.flatMap((item) => item.changes),
		exceptionId,
		ownership: { regionIds },
		selection: selections[0] ?? null,
	};
}

export function mapVisibleSelection(
	context: SelectionContext,
	selection: SelectionSnapshot,
): EditorSelection {
	const sharedPrefix = context.protectedRanges.find((range) =>
		range.from < selection.anchor && selection.anchor < range.to &&
		range.from < selection.head && selection.head < range.to);
	if (sharedPrefix) return EditorSelection.single(sharedPrefix.to);
	const first = context.segments[0];
	const last = context.segments.at(-1);
	if (!first || !last) return EditorSelection.single(selection.anchor, selection.head);
	return selection.anchor <= selection.head
		? EditorSelection.single(first.selectedContent.from, last.selectedContent.to)
		: EditorSelection.single(last.selectedContent.to, first.selectedContent.from);
}

const cutRegionKinds = new Set([
	'selection-start-content',
	'selection-end-content',
	'selection-intervening-item',
	'whitespace-boundary',
	'structural-boundary',
]);

function resolvedCutRegions(context: SelectionContext) {
	if (context.editScope.mode !== 'editable') return null;
	if (context.editScope.regionIds.some((id) => !cutRegionKinds.has(id.kind))) return null;
	const regions = context.editScope.regionIds.map((id) => context.editScope.region(id));
	if (regions.some((region) => region === null)) return null;
	return regions.flatMap((region) => region ? [region] : []).sort((left, right) =>
		left.range.from - right.range.from || left.range.to - right.range.to);
}

function cutRegionsCoverSelection(
	context: SelectionContext,
	regions: NonNullable<ReturnType<typeof resolvedCutRegions>>,
): boolean {
	const from = Math.min(context.selection.anchor, context.selection.head);
	const to = Math.max(context.selection.anchor, context.selection.head);
	const nonEmpty = regions.filter((region) => region.range.from < region.range.to);
	if (nonEmpty[0]?.range.from !== from || nonEmpty.at(-1)?.range.to !== to) return false;
	return nonEmpty.every((region, index) =>
		index === 0 || nonEmpty[index - 1]?.range.to === region.range.from);
}

export function createSelectionCutPlan(
	context: SelectionContext,
): EditPlan | null {
	const regions = resolvedCutRegions(context);
	if (!regions || !cutRegionsCoverSelection(context, regions)) return null;
	const changes = regions.flatMap(({ range }) =>
		range.from < range.to ? [{ from: range.from, insert: '', to: range.to }] : []);
	if (changes.length === 0) return null;
	const position = Math.min(context.selection.anchor, context.selection.head);
	return {
		changes,
		exceptionId: 'SLX-006',
		ownership: { regionIds: context.editScope.regionIds },
		selection: EditorSelection.single(position),
	};
}
