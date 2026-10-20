import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { invertedEffects } from '@codemirror/commands';
import {
	Facet,
	EditorSelection,
	Prec,
	RangeSet,
	RangeValue,
	StateField,
	StateEffect,
	type EditorState,
	type Extension,
	type Transaction,
} from '@codemirror/state';
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import type { AtxHeadingBlock, ParagraphBlock, SetextHeadingBlock } from './model.js';
import { confirmedSyntaxEnd, discoverAtxHeadings, discoverParagraphAuthority, type HeadingBodyLine } from './syntax.js';
import { discoverSetextHeadings } from './setext.js';
import { classifyCurrentSelectionMode, requireCompositionState } from '../runtime/input-state.js';

export const containerHeadingBodyLines = Facet.define<(state: EditorState) => readonly HeadingBodyLine[]>();

function bodyLines(state: EditorState): readonly HeadingBodyLine[] {
	return state.facet(containerHeadingBodyLines).flatMap(provider => provider(state));
}

function headingBodyFrom(state: EditorState, lineFrom: number): number {
	return bodyLines(state).find(line => line.from === lineFrom)?.bodyFrom ?? lineFrom;
}

export interface HeadingProjectionState {
	readonly atomicRanges: RangeSet<RangeValue>;
	readonly complete: boolean;
	readonly decorations: DecorationSet;
	readonly editSession: HeadingEditSession | null;
	readonly focusedHeading: AtxHeadingBlock | null;
	readonly headings: readonly AtxHeadingBlock[];
	readonly setextHeadings: readonly SetextHeadingBlock[];
	readonly setextDecorations: DecorationSet;
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

const restoreHeadingEditSession = StateEffect.define<HeadingEditSession | null>({
	map: (session, changes) => session === null ? null : {
		...session,
		lineFrom: changes.mapPos(session.lineFrom, -1),
		lineTo: changes.mapPos(session.lineTo, 1),
		prefixTo: changes.mapPos(session.prefixTo, 1),
	},
});

export interface HeadingPresentation {
	readonly from: number;
	readonly level: AtxHeadingBlock['level'];
	readonly state: HeadingEditPhase | 'committed';
	readonly to: number;
}

interface HeadingFieldState extends HeadingProjectionState {
	readonly enabled: boolean;
	readonly editEligibleBlocks: readonly ParagraphBlock[];
	readonly tree: Tree;
	readonly confirmedTo: number;
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
		const label = badge.ownerDocument.createElement('span');
		label.className = 'paraflow-heading-badge-label';
		label.textContent = `h${this.level}`;
		badge.append(label);
		return badge;
	}
}

function headingEditEligibleBlocks(state: EditorState): readonly ParagraphBlock[] {
	return Object.freeze([...discoverParagraphAuthority(state).blocks
		.filter(({ kind }) => kind === 'paragraph' || kind === 'heading')
		.map(({ from, to }) => Object.freeze({ from, to })), ...bodyLines(state).filter(line => syntaxTreeAvailable(state, line.to))]
		.sort((a, b) => a.from - b.from));
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
	const bodyFrom = headingBodyFrom(state, line.from);
	const match = /^(#{1,6})(?:([ \t]+)(.*))?$/u.exec(state.sliceDoc(bodyFrom, line.to));
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
		prefixTo: bodyFrom + match[1]!.length + separator.length,
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
	const previousPosition = transaction.changes.invertedDesc.mapPos(candidate.lineFrom, -1);
	const previousLine = transaction.startState.doc.lineAt(previousPosition);
	if (transaction.startState.sliceDoc(headingBodyFrom(transaction.startState, previousLine.from), previousLine.to).trim()) return null;
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
	const setextHeadings = discoverSetextHeadings(state);
	const stable = editSession
		? headings.filter((heading) => heading.from !== editSession.lineFrom)
		: headings;
	const focusedHeading = focusedCommittedHeading(state, stable, editSession);
	const decorations = [
		...stable.map((heading) => Decoration.line({ attributes: {
			class: `paraflow-heading-line paraflow-heading-line--h${heading.level}`,
		} }).range(heading.from)),
		...stable.filter(heading => heading.contentFrom < heading.to).map((heading) => Decoration.mark({ class: 'paraflow-heading-body' })
			.range(heading.contentFrom, heading.to)),
		...stable.map((heading) =>
			Decoration.replace({ widget: new HeadingMarkerWidget(heading.level) })
				.range(heading.prefixFrom, heading.prefixTo)),
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
					.range(headingBodyFrom(state, editSession.lineFrom), editSession.prefixTo),
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
		...setextHeadings.map(heading => ({ from: heading.from, to: heading.to, level: heading.level, state: 'committed' as const })),
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
		atomicRanges: RangeSet.of([...stable.map((heading) =>
			new HeadingPrefixRangeValue().range(heading.prefixFrom, heading.prefixTo)),
			...setextHeadings.map(heading => new HeadingPrefixRangeValue().range(heading.contentTo, heading.to))], true),
		complete,
		confirmedTo: confirmedSyntaxEnd(state),
		decorations: Decoration.set(decorations, true),
		enabled: state.facet(headingProjectionEnabled)(state),
		editEligibleBlocks,
		editSession,
		focusedHeading,
		headings: Object.freeze(headings),
		setextHeadings,
		setextDecorations: Decoration.set(setextHeadings.flatMap(heading => [
			...heading.lines.map(line => Decoration.line({ class: `paraflow-heading-line paraflow-heading-line--h${heading.level}` }).range(line.from)),
			...heading.lines.filter(line => line.contentFrom < line.to).map(line => Decoration.mark({ class: 'paraflow-heading-body' }).range(line.contentFrom, line.to)),
			Decoration.replace({}).range(heading.contentTo, heading.to),
		]), true),
		presentations: Object.freeze(presentations),
		tree,
	});
}

function build(state: EditorState, editSession: HeadingEditSession | null = null): HeadingFieldState {
	const tree = syntaxTree(state);
	const complete = syntaxTreeAvailable(state, state.doc.length);
	const headings = discoverAtxHeadings(state, bodyLines(state));
	const editEligibleBlocks = headingEditEligibleBlocks(state);
	return projectHeadings(
		state,
		tree,
		complete,
		headings,
		editEligibleBlocks,
		editSession,
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
		const confirmedTo = confirmedSyntaxEnd(transaction.state);
		const enabled = transaction.state.facet(headingProjectionEnabled)(transaction.state);
		if (!enabled && value.enabled === enabled && value.editSession === null && !transaction.docChanged &&
			!transaction.reconfigured &&
			value.tree === tree && value.confirmedTo === confirmedTo) return value;
		if (!transaction.docChanged && !transaction.reconfigured &&
			value.tree === tree && value.confirmedTo === confirmedTo) {
			if (!transaction.selection && enabled && value.enabled === enabled) return value;
			const editSession = enabled
				? editSessionAfterTransaction(
					value,
					transaction,
					value.headings,
					value.editEligibleBlocks,
				)
				: null;
			const focusedHeading = enabled
				? focusedCommittedHeading(transaction.state, value.headings, editSession)
				: null;
			if (value.enabled === enabled && editSession === value.editSession &&
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
		const headings = discoverAtxHeadings(transaction.state, bodyLines(transaction.state));
		const editEligibleBlocks = headingEditEligibleBlocks(transaction.state);
		// Joined history stores inverse effects newest-to-oldest. The final
		// snapshot describes the state before the entire undo group.
		const restored = transaction.effects.filter(effect => effect.is(restoreHeadingEditSession)).at(-1);
		return projectHeadings(
			transaction.state,
			tree,
			complete,
			headings,
			editEligibleBlocks,
			enabled
				? restored && (!restored.value || isHeadingEditLineEligible(editEligibleBlocks, restored.value.lineFrom, restored.value.lineTo))
					? restored.value : editSessionAfterTransaction(value, transaction, headings, editEligibleBlocks)
				: null,
		);
	},
	provide: field => invertedEffects.of(transaction => {
		if (!transaction.docChanged) return [];
		const before = transaction.startState.field(field), after = transaction.state.field(field);
		let removedPrefix = false;
		transaction.changes.iterChangedRanges((from, to) => {
			if (from < to && before.headings.some(heading => from < heading.prefixTo && heading.prefixFrom < to)) removedPrefix = true;
		});
		// Preserve committed identity when Undo restores a removed prefix, without retaining unrelated temporary edits.
		return before.editSession || after.editSession || removedPrefix
			? [restoreHeadingEditSession.of(before.editSession)] : [];
	}),
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
	return projection.headings.find((heading) =>
		heading.contentFrom <= position && position <= heading.to) ?? null;
}

/** Visible title-row ownership takes precedence over generic container boundaries. */
export function headingBodyLineAt(state: EditorState, position: number): { readonly contentFrom: number; readonly to: number } | null {
	const projection = getHeadingProjectionState(state);
	if (!projection || !state.facet(headingProjectionEnabled)(state)) return null;
	return projection.headings.find(heading => heading.from !== projection.editSession?.lineFrom &&
		heading.contentFrom <= position && position <= heading.to) ??
		projection.setextHeadings.flatMap(heading => heading.lines).find(line => line.contentFrom <= position && position <= line.to) ?? null;
}

export function normalizeHeadingSelectionEndpoint(
	state: EditorState,
	position: number,
	bias: -1 | 1,
	leavePrefix = false,
): number {
	const projection = getHeadingProjectionState(state);
	if (!projection) return position;
	if (!state.facet(headingProjectionEnabled)(state)) return position;
	const setext = projection.setextHeadings.find(heading => heading.contentTo < position && position <= heading.to);
	if (setext) return bias > 0 && setext.to < state.doc.length ? setext.to + 1 : setext.contentTo;
	const heading = projection.headings.find((candidate) =>
		candidate.from !== projection.editSession?.lineFrom &&
		candidate.prefixFrom <= position && position < candidate.contentFrom);
	if (!heading) return position;
	if(leavePrefix&&bias<0&&heading.prefixFrom>0)return heading.prefixFrom-1;
	return heading.contentFrom;
}

export function createHeadingProjection(
	isActive: (view: EditorView) => boolean,
	isStateActive: (state: EditorState) => boolean = () => true,
): Extension {
	const headingHome = (view: EditorView, extend: boolean): boolean => {
		if (!isActive(view) || view.composing || requireCompositionState(view.state) ||
			view.state.selection.ranges.length !== 1 ||
			!['caret', 'continuous', 'unknown'].includes(classifyCurrentSelectionMode(view.state))) return false;
		const range = view.state.selection.main;
		const titleRow = headingBodyLineAt(view.state, range.head);
		if (!titleRow) return false;
		// The key establishes normal intent even after an unannotated native End selection.
		// Resolve before CM skips the atomic prefix to the preceding physical line.
		const start = Math.max(view.moveToLineBoundary(range, false, true).head, titleRow.contentFrom);
		view.dispatch({ selection: extend ? EditorSelection.range(range.anchor, start) : EditorSelection.cursor(start, 1),
			scrollIntoView: true, userEvent: 'select' });
		return true;
	};
	const setextEnd = (view: EditorView, extend: boolean): boolean => {
		if (!isActive(view) || view.composing || requireCompositionState(view.state) ||
			view.state.selection.ranges.length !== 1 ||
			!['caret', 'continuous', 'unknown'].includes(classifyCurrentSelectionMode(view.state))) return false;
		const range = view.state.selection.main;
		const heading = requireHeadingProjectionState(view.state).setextHeadings.find(candidate =>
			candidate.contentFrom <= range.head && range.head <= candidate.contentTo);
		if (!heading) return false;
		// CM's visual line includes the hidden suffix; End owns only its visible title.
		const end = Math.min(view.moveToLineBoundary(range, true, true).head, heading.contentTo);
		view.dispatch({ selection: extend ? EditorSelection.range(range.anchor, end) : EditorSelection.cursor(end, -1), scrollIntoView: true, userEvent: 'select' });
		return true;
	};
	return [
		Prec.highest(keymap.of([
			{ key: 'Home', run: view => headingHome(view, false), shift: view => headingHome(view, true) },
			{ key: 'End', run: view => setextEnd(view, false), shift: view => setextEnd(view, true) },
		])),
		EditorView.baseTheme(Object.fromEntries(Array.from({ length: 6 }, (_value, index) => {
			const level = index + 1;
			return [`.paraflow-heading-line--h${level}`, {
				fontFamily: `var(--h${level}-font)`, fontSize: `var(--h${level}-size)`,
				fontWeight: `var(--h${level}-weight)`, fontStyle: `var(--h${level}-style)`,
				color: `var(--h${level}-color)`, lineHeight: `var(--h${level}-line-height)`,
			}];
		}))),
		headingProjectionEnabled.of(isStateActive),
		headingProjectionField,
		// Line-spanning replacements must be state-direct so CM can build its viewport.
		EditorView.decorations.compute([headingProjectionField], state => isStateActive(state)
			? requireHeadingProjectionState(state).setextDecorations : Decoration.none),
		EditorView.decorations.of((view) =>
			isActive(view) ? requireHeadingProjectionState(view.state).decorations : Decoration.none),
		EditorView.atomicRanges.of((view) =>
			isActive(view) ? requireHeadingProjectionState(view.state).atomicRanges : RangeSet.empty),
	];
}
