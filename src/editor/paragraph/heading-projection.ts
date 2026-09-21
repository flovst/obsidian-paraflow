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
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import type { AtxHeadingBlock, ParagraphBlock } from './model.js';
import { discoverAtxHeadings, discoverParagraphAuthority } from './syntax.js';

export interface HeadingProjectionState {
	readonly atomicRanges: RangeSet<RangeValue>;
	readonly complete: boolean;
	readonly decorations: DecorationSet;
	readonly editSession: HeadingEditSession | null;
	readonly focusedHeading: AtxHeadingBlock | null;
	readonly headings: readonly AtxHeadingBlock[];
	readonly presentations: readonly HeadingPresentation[];
}

export type HeadingEditPhase = 'prefix-only' | 'empty-body' | 'active-body';

export interface HeadingEditSession {
	readonly lineFrom: number;
	readonly lineTo: number;
	readonly level: AtxHeadingBlock['level'];
	readonly phase: HeadingEditPhase;
	readonly prefixTo: number;
}

export interface HeadingPresentation {
	readonly from: number;
	readonly level: AtxHeadingBlock['level'];
	readonly state: HeadingEditPhase | 'committed';
	readonly to: number;
}

interface HeadingFieldState extends HeadingProjectionState {
	readonly editEligibleBlocks: readonly ParagraphBlock[];
	readonly tree: Tree;
}

class HeadingPrefixRangeValue extends RangeValue {}

class HeadingMarkerWidget extends WidgetType {
	constructor(private readonly level: AtxHeadingBlock['level']) { super(); }

	eq(other: WidgetType): boolean {
		return other instanceof HeadingMarkerWidget && other.level === this.level;
	}

	ignoreEvent(): boolean { return true; }

	toDOM(): HTMLElement {
		const marker = createSpan();
		marker.className = `paraflow-heading-marker paraflow-heading-marker--h${this.level}`;
		marker.setAttribute('aria-hidden', 'true');
		return marker;
	}
}

class HeadingBadgeWidget extends WidgetType {
	constructor(private readonly level: AtxHeadingBlock['level']) { super(); }

	eq(other: WidgetType): boolean {
		return other instanceof HeadingBadgeWidget && other.level === this.level;
	}

	ignoreEvent(): boolean { return true; }

	toDOM(): HTMLElement {
		const badge = createSpan();
		badge.className = 'paraflow-heading-badge';
		badge.setAttribute('aria-hidden', 'true');
		badge.textContent = `h${this.level}`;
		return badge;
	}
}

function headingEditEligibleBlocks(state: EditorState): readonly ParagraphBlock[] {
	return Object.freeze(discoverParagraphAuthority(state).blocks
		.filter(({ kind }) => kind === 'paragraph' || kind === 'heading')
		.map(({ from, to }) => Object.freeze({ from, to })));
}

function isHeadingEditLineEligible(
	blocks: readonly ParagraphBlock[],
	from: number,
	to: number,
): boolean {
	let low = 0;
	let high = blocks.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		if (blocks[middle]!.from <= from) low = middle + 1;
		else high = middle - 1;
	}
	const block = high >= 0 ? blocks[high] : undefined;
	return block !== undefined && block.from <= from && to <= block.to;
}

function editSessionAtSelection(
	state: EditorState,
	editEligibleBlocks: readonly ParagraphBlock[],
): HeadingEditSession | null {
	if (state.selection.ranges.length !== 1) return null;
	const selection = state.selection.main;
	const line = state.doc.lineAt(selection.head);
	if (state.doc.lineAt(selection.anchor).from !== line.from) return null;
	if (!isHeadingEditLineEligible(editEligibleBlocks, line.from, line.to)) return null;
	const match = /^(#{1,6})(?:([ \t]+)(.*))?$/u.exec(line.text);
	if (!match) return null;
	const level = match[1]!.length as AtxHeadingBlock['level'];
	const separator = match[2] ?? '';
	const body = match[3];
	return Object.freeze({
		level,
		lineFrom: line.from,
		lineTo: line.to,
		phase: separator.length === 0
			? 'prefix-only'
			: body?.length === 0 ? 'empty-body' : 'active-body',
		prefixTo: line.from + match[1]!.length + separator.length,
	});
}

function mappedPreviousHeading(
	value: HeadingFieldState,
	transaction: Transaction,
	heading: AtxHeadingBlock,
): AtxHeadingBlock | null {
	return value.headings.find((previous) => {
		const from = transaction.changes.mapPos(previous.from, 1);
		const to = transaction.changes.mapPos(previous.to, -1);
		return from < to && from === heading.from && to === heading.to;
	}) ?? null;
}

function changeTouchesHeading(
	value: HeadingFieldState,
	transaction: Transaction,
	heading: AtxHeadingBlock,
): boolean {
	const previous = mappedPreviousHeading(value, transaction, heading);
	let touches = false;
	transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
		if (touches) return;
		if (previous) {
			const removedFromHeading = fromA < toA &&
				fromA < previous.to && previous.from < toA;
			const insertedIntoHeading = fromB < toB &&
				fromB < heading.to && heading.from < toB;
			touches = removedFromHeading || insertedIntoHeading;
			return;
		}
		touches = fromB === toB
			? heading.from <= fromB && fromB <= heading.to
			: fromB < heading.to && heading.from < toB;
	});
	return touches;
}

function changeTouchesEditLine(
	value: HeadingFieldState,
	transaction: Transaction,
	session: HeadingEditSession,
	headings: readonly AtxHeadingBlock[],
): boolean {
	const heading = headings.find((candidate) => candidate.from === session.lineFrom);
	if (heading) return changeTouchesHeading(value, transaction, heading);
	const previous = value.headings.find((candidate) =>
		transaction.changes.mapPos(candidate.from, -1) === session.lineFrom);
	let touches = false;
	transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
		if (touches) return;
		const removedFromPrevious = previous !== undefined && fromA < toA &&
			fromA < previous.to && previous.from < toA;
		const insertedIntoLine = fromB < toB &&
			fromB < session.lineTo && session.lineFrom < toB;
		touches = removedFromPrevious || insertedIntoLine;
	});
	return touches;
}

function sessionLineWasRemoved(
	session: HeadingEditSession,
	transaction: Transaction,
): boolean {
	let removed = false;
	transaction.changes.iterChangedRanges((fromA, toA) => {
		if (fromA <= session.lineFrom && toA > session.lineTo) removed = true;
	});
	return removed;
}

function candidateContainsMappedSession(
	session: HeadingEditSession,
	transaction: Transaction,
	candidate: HeadingEditSession,
): boolean {
	if (sessionLineWasRemoved(session, transaction)) return false;
	const mappedFrom = transaction.changes.mapPos(session.lineFrom, 1);
	const mappedTo = transaction.changes.mapPos(session.lineTo, -1);
	return mappedFrom < mappedTo &&
		candidate.lineFrom <= mappedFrom && mappedTo <= candidate.lineTo;
}

function editSessionAfterTransaction(
	value: HeadingFieldState,
	transaction: Transaction,
	headings: readonly AtxHeadingBlock[],
	editEligibleBlocks: readonly ParagraphBlock[],
): HeadingEditSession | null {
	const candidate = editSessionAtSelection(transaction.state, editEligibleBlocks);
	if (!candidate) return null;
	const previous = value.editSession;
	if (previous) {
		return candidateContainsMappedSession(previous, transaction, candidate)
			? candidate
			: null;
	}
	if (!transaction.state.selection.main.empty) return null;
	if (value.headings.some((heading) =>
		transaction.changes.mapPos(heading.from, 1) === candidate.lineFrom)) return null;
	return transaction.docChanged && changeTouchesEditLine(value, transaction, candidate, headings)
		? candidate
		: null;
}

function focusedCommittedHeading(
	state: EditorState,
	headings: readonly AtxHeadingBlock[],
	editSession: HeadingEditSession | null,
): AtxHeadingBlock | null {
	if (state.selection.ranges.length !== 1) return null;
	const { anchor, head } = state.selection.main;
	const anchorLine = state.doc.lineAt(anchor);
	if (state.doc.lineAt(head).from !== anchorLine.from) return null;
	return headings.find((heading) =>
		heading.from !== editSession?.lineFrom &&
		heading.from <= Math.min(anchor, head) &&
		Math.max(anchor, head) <= heading.to) ?? null;
}

function sameFocusedHeading(
	left: AtxHeadingBlock | null,
	right: AtxHeadingBlock | null,
): boolean {
	return left === right || (left !== null && right !== null &&
		left.from === right.from && left.to === right.to && left.level === right.level);
}

function projectHeadings(
	state: EditorState,
	tree: Tree,
	complete: boolean,
	headings: readonly AtxHeadingBlock[],
	editEligibleBlocks: readonly ParagraphBlock[],
	editSession: HeadingEditSession | null,
): HeadingFieldState {
	const stable = editSession
		? headings.filter((heading) => heading.from !== editSession.lineFrom)
		: headings;
	const headingLines = new Set(headings.map((heading) => heading.from));
	const focusedHeading = focusedCommittedHeading(state, stable, editSession);
	const decorations = [
		...stable.map((heading) =>
			Decoration.replace({ widget: new HeadingMarkerWidget(heading.level) })
				.range(heading.prefixFrom, heading.prefixTo)),
		...stable.flatMap((heading) => {
			if (heading.to >= state.doc.length) return [];
			const nextLineFrom = state.doc.lineAt(heading.to + 1).from;
			if (headingLines.has(nextLineFrom)) return [];
			return [Decoration.line({ attributes: { class: 'paraflow-heading-following-line' } })
				.range(nextLineFrom)];
		}),
		...(focusedHeading
			? [Decoration.line({ attributes: { class: 'paraflow-heading-focused-line' } })
				.range(focusedHeading.from)]
			: []),
		...(focusedHeading && focusedHeading.level >= 3
			? [Decoration.widget({
				widget: new HeadingBadgeWidget(focusedHeading.level),
				side: -1,
			}).range(focusedHeading.contentFrom)]
			: []),
		...(editSession
			? [
				Decoration.line({
					attributes: {
						class: `paraflow-heading-edit-line paraflow-heading-edit-line--${editSession.phase} ` +
							`paraflow-heading-edit-line--h${editSession.level}`,
					},
				}).range(editSession.lineFrom),
				Decoration.mark({ class: 'paraflow-heading-edit-prefix' })
					.range(editSession.lineFrom, editSession.prefixTo),
				...(editSession.phase === 'active-body'
					? [Decoration.mark({ class: 'paraflow-heading-edit-body' })
						.range(editSession.prefixTo, editSession.lineTo)]
					: []),
			]
			: []),
		...(editSession && editSession.phase !== 'prefix-only' && editSession.level >= 3
			? [Decoration.widget({ widget: new HeadingBadgeWidget(editSession.level), side: -1 })
				.range(editSession.lineFrom)]
			: []),
	];
	const presentations: HeadingPresentation[] = [
		...stable.map((heading) => Object.freeze({
			from: heading.from,
			level: heading.level,
			state: 'committed' as const,
			to: heading.to,
		})),
		...(editSession ? [Object.freeze({
			from: editSession.lineFrom,
			level: editSession.level,
			state: editSession.phase,
			to: editSession.lineTo,
		})] : []),
	].sort((left, right) => left.from - right.from);
	return Object.freeze({
		atomicRanges: RangeSet.of(stable.map((heading) =>
			new HeadingPrefixRangeValue().range(heading.prefixFrom, heading.prefixTo)), true),
		complete,
		decorations: Decoration.set(decorations, true),
		editEligibleBlocks,
		editSession,
		focusedHeading,
		headings: Object.freeze(headings),
		presentations: Object.freeze(presentations),
		tree,
	});
}

function build(state: EditorState, editSession: HeadingEditSession | null = null): HeadingFieldState {
	const tree = syntaxTree(state);
	const complete = syntaxTreeAvailable(state, state.doc.length);
	const headings = complete ? discoverAtxHeadings(state) : [];
	const editEligibleBlocks = complete ? headingEditEligibleBlocks(state) : [];
	return projectHeadings(
		state,
		tree,
		complete,
		headings,
		editEligibleBlocks,
		complete ? editSession : null,
	);
}

const headingProjectionEnabled = Facet.define<
	(state: EditorState) => boolean,
	(state: EditorState) => boolean
>({
	combine: (predicates) => (state) => predicates.every((predicate) => predicate(state)),
});

export const headingProjectionField = StateField.define<HeadingFieldState>({
	create: build,
	update(value, transaction) {
		const tree = syntaxTree(transaction.state);
		const complete = syntaxTreeAvailable(transaction.state, transaction.state.doc.length);
		const enabled = transaction.state.facet(headingProjectionEnabled)(transaction.state);
		if (!enabled && value.editSession === null && !transaction.docChanged &&
			!transaction.reconfigured &&
			value.tree === tree && value.complete === complete) return value;
		if (!transaction.docChanged && !transaction.reconfigured &&
			value.tree === tree && value.complete === complete) {
			if (!transaction.selection && enabled) return value;
			const editSession = enabled && complete
				? editSessionAfterTransaction(
					value,
					transaction,
					value.headings,
					value.editEligibleBlocks,
				)
				: null;
			const focusedHeading = enabled && complete
				? focusedCommittedHeading(transaction.state, value.headings, editSession)
				: null;
			if (editSession === value.editSession &&
				sameFocusedHeading(focusedHeading, value.focusedHeading)) return value;
			return projectHeadings(
				transaction.state,
				value.tree,
				value.complete,
				value.headings,
				value.editEligibleBlocks,
				editSession,
			);
		}
		const headings = complete ? discoverAtxHeadings(transaction.state) : [];
		const editEligibleBlocks = complete ? headingEditEligibleBlocks(transaction.state) : [];
		return projectHeadings(
			transaction.state,
			tree,
			complete,
			headings,
			editEligibleBlocks,
			enabled && complete
				? editSessionAfterTransaction(value, transaction, headings, editEligibleBlocks)
				: null,
		);
	},
});

export function getHeadingProjectionState(state: EditorState): HeadingProjectionState | null {
	return state.field(headingProjectionField, false) ?? null;
}

export function requireHeadingProjectionState(state: EditorState): HeadingProjectionState {
	const value = getHeadingProjectionState(state);
	if (!value) throw new Error('Heading projection state is required');
	return value;
}

export function headingAtCaret(
	state: EditorState,
	position: number,
): AtxHeadingBlock | null {
	const projection = requireHeadingProjectionState(state);
	if (!projection.complete) return null;
	return projection.headings.find((heading) =>
		heading.contentFrom <= position && position <= heading.to) ?? null;
}

export function normalizeHeadingSelectionEndpoint(
	state: EditorState,
	position: number,
	_bias: -1 | 1,
): number {
	const projection = getHeadingProjectionState(state);
	if (!projection?.complete) return position;
	const heading = projection.headings.find((candidate) =>
		candidate.from !== projection.editSession?.lineFrom &&
		candidate.prefixFrom <= position && position < candidate.contentFrom);
	if (!heading) return position;
	return heading.contentFrom;
}

export function createHeadingProjection(
	isActive: (view: EditorView) => boolean,
	isStateActive: (state: EditorState) => boolean = () => true,
): Extension {
	return [
		headingProjectionEnabled.of(isStateActive),
		headingProjectionField,
		EditorView.decorations.of((view) =>
			isActive(view) ? requireHeadingProjectionState(view.state).decorations : Decoration.none),
		EditorView.atomicRanges.of((view) =>
			isActive(view) ? requireHeadingProjectionState(view.state).atomicRanges : RangeSet.empty),
	];
}
