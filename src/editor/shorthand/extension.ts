import { EditorSelection, EditorState, Prec, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { classifyCurrentSelectionMode, createInputStateExtension, recognizedNormalSelectionTransaction, requireCompositionState } from '../runtime/input-state.js';
import { createInlineRevealPointerExtension, inlineEndpointOwners, inlineRevealPointerHeld, type InlineBodyOwner } from '../runtime/inline-reveal.js';
import { shorthandAnalysis, type ShorthandRange, type ShorthandSettings } from './syntax.js';
import { shorthandSettings, tildeRuns } from './tilde-run.js';
import { bindRenderedSourceClick, createRenderedSourceClickExtension } from '../runtime/rendered-source-click.js';
import { createNativeDecorationOwnership, nativeInlineOwnership, isNativeReplacement } from '../runtime/native-decoration-ownership.js';

const shorthandRanges = StateField.define<readonly ShorthandRange[]>({
	create: state => shorthandAnalysis(state.doc).shorthand,
	update: (value, transaction) => transaction.docChanged ? shorthandAnalysis(transaction.newDoc).shorthand : value,
});

const escapedBodyCharacter = /[ \t!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/u;

export function createShorthandExtension(options: { isActive(view: EditorView): boolean; getSettings(): ShorthandSettings }): Extension {
	// Rendered edges enter outside hidden syntax; exposed-source editing stays granular.
	const presentation = new WeakMap<EditorState, { active: readonly InlineBodyOwner[]; view: EditorView }>();
	const normalizeRenderedEdges = EditorState.transactionFilter.of(transaction => {
		const before = presentation.get(transaction.startState);
		if (!before || transaction.docChanged || transaction.reconfigured || !options.isActive(before.view) ||
			before.view.compositionStarted || before.view.composing || requireCompositionState(transaction.startState)) return transaction;
		const released = inlineRevealPointerHeld(transaction.startState) && !inlineRevealPointerHeld(transaction.state);
		const mode = classifyCurrentSelectionMode(transaction.state);
		if ((!released && !recognizedNormalSelectionTransaction(transaction)) || inlineRevealPointerHeld(transaction.state) ||
			(mode !== 'caret' && mode !== 'continuous')) return transaction;
		const selected = transaction.newSelection.main;
		const settings = options.getSettings();
		const edges: Array<{ from: number; to: number; bodyFrom: number; bodyTo: number }> = [];
		const rendered = (item: { from: number; to: number }) => !before.active.some(owner => owner.from === item.from && owner.to === item.to);
		for (const item of transaction.startState.field(shorthandRanges).filter(item => settings[item.kind] && rendered(item))) {
			const bodyStart = transaction.startState.sliceDoc(item.from + 1, item.from + 3);
			const visibleFrom = item.from + (bodyStart[0] === '\\' && escapedBodyCharacter.test(bodyStart[1]!) ? 2 : 1);
			edges.push({ ...item, bodyFrom: visibleFrom, bodyTo: item.to - 1 });
		}
		if (settings.subscript) for (const run of transaction.startState.field(tildeRuns)) {
			for (const part of run.parts.filter(rendered)) {
				const first = transaction.startState.sliceDoc(part.bodyFrom, part.bodyFrom + 2);
				edges.push({ ...part, bodyFrom: part.bodyFrom + (first[0] === '\\' && escapedBodyCharacter.test(first[1]!) ? 1 : 0) });
			}
		}
		const outside = (position: number): number => {
			for (const edge of edges) {
				if (edge.from < position && position <= edge.bodyFrom) return edge.from;
				if (edge.bodyTo <= position && position < edge.to) return edge.to;
			}
			return position;
		};
		const anchor = outside(selected.anchor), head = outside(selected.head);
		if (anchor === selected.anchor && head === selected.head) return transaction;
		return [transaction, { selection: EditorSelection.single(anchor, head),
			userEvent: released ? 'select.pointer' : 'select' }];
	});
	function project(view: EditorView, previousActive: readonly InlineBodyOwner[], frozenActive?: readonly InlineBodyOwner[]): {
		decorations: DecorationSet; nativeOwners: DecorationSet; active: readonly InlineBodyOwner[];
	} {
		if (!options.isActive(view)) return { decorations: Decoration.none, nativeOwners: Decoration.none, active: [] };
		const settings = options.getSettings();
		const ranges: Range<Decoration>[] = [];
		const nativeOwners: Range<Decoration>[] = [];
		const visible = (item: { from: number; to: number }) => view.visibleRanges.some(range => range.from <= item.to && range.to >= item.from);
		const owners: InlineBodyOwner[] = [
			...view.state.field(shorthandRanges).filter(item => settings[item.kind] && visible(item)).map(item => ({
				from: item.from, to: item.to, bodies: [{ from: item.from, to: item.to }],
			})),
			...(settings.subscript ? view.state.field(tildeRuns).filter(visible).flatMap(run => run.parts.map(part => ({
				from: part.from, to: part.to, bodies: [{ from: part.from, to: part.to }],
			}))) : []),
		];
		const matching = (items: readonly InlineBodyOwner[]) => owners.filter(owner => items.some(item => item.from === owner.from && item.to === owner.to));
		const endpoints = [...inlineEndpointOwners(view.state, owners)];
		const mode = classifyCurrentSelectionMode(view.state);
		const caret = view.state.selection.main;
		if (settings.subscript && (mode === 'caret' || mode === 'continuous')) {
			for (const position of [caret.anchor, caret.head]) {
				for (const run of view.state.field(tildeRuns)) {
					if (!run.parts.some((part, index) => index > 0 && part.from === position && run.parts[index - 1]!.to === position)) continue;
					// The shared boundary touches both owners; exposing both prevents a hidden-marker arrow trap.
					endpoints.push(...owners.filter(owner => owner.from === position || owner.to === position));
				}
			}
		}
		const synchronized = (mode === 'caret' || mode === 'unknown') && view.state.selection.ranges.length === 1 && caret.empty
			? previousActive.filter(item => item.from <= caret.head && caret.head <= item.to) : [];
		const active = frozenActive ? matching(frozenActive) : endpoints.length > 0 ? endpoints : matching(synchronized);
		const revealed = (item: { from: number; to: number }) => active.some(owner => owner.from === item.from && owner.to === item.to);
		if (settings.subscript) for (const run of view.state.field(tildeRuns)) {
			if (!view.visibleRanges.some(visible => visible.from <= run.to && visible.to >= run.from)) continue;
			// Source-backed bodies let CM paint and hit-test every character independently.
			ranges.push(Decoration.mark({ class: 'paraflow-invalid-native-strike' }).range(run.from, run.to));
			for (const part of run.parts) {
				const isRevealed = revealed(part);
				const marker = isRevealed ? Decoration.mark({ class: 'paraflow-inline-source-active' }) : Decoration.replace({});
				ranges.push(marker.range(part.from, part.bodyFrom), marker.range(part.bodyTo, part.to));
				ranges.push(Decoration.mark({ class: `paraflow-inline-body paraflow-inline-body--${part.kind}` })
					.range(part.kind === 'subscript' ? part.from : part.bodyFrom, part.kind === 'subscript' ? part.to : part.bodyTo));
				if (!isRevealed) {
					const body = view.state.sliceDoc(part.bodyFrom, part.bodyTo);
					for (let index = 0; index < body.length - 1; index++) {
						if (body[index] === '\\' && escapedBodyCharacter.test(body[index + 1]!)) {
							ranges.push(Decoration.replace({}).range(part.bodyFrom + index, part.bodyFrom + index + 1)); index++;
						}
					}
				}
			}
		}
		for (const item of view.state.field(shorthandRanges)) {
			if (!settings[item.kind] || !view.visibleRanges.some(visible => visible.from <= item.to && visible.to >= item.from)) continue;
			if (item.kind === 'superscript') {
				const line = view.state.doc.lineAt(item.to);
				// HyperMD can mistake this owned closing marker and its suffix for a block ID.
				if (/^[a-zA-Z0-9-]+$/u.test(view.state.sliceDoc(item.to, line.to))) {
					nativeOwners.push(Decoration.mark({ class: 'paraflow-shorthand-blockid-conflict' }).range(item.to - 1, line.to));
				}
			}
			const isRevealed = revealed(item);
			const marker = isRevealed ? Decoration.mark({ class: 'paraflow-inline-source-active' }) : Decoration.replace({});
			ranges.push(marker.range(item.from, item.from + 1), marker.range(item.to - 1, item.to));
			ranges.push(Decoration.mark({ class: `paraflow-inline-body paraflow-inline-body--${item.kind}` }).range(item.from, item.to));
			if (!isRevealed) {
				const body = view.state.sliceDoc(item.from + 1, item.to - 1);
				for (let index = 0; index < body.length - 1; index++) {
					if (body[index] === '\\' && escapedBodyCharacter.test(body[index + 1]!)) {
						ranges.push(Decoration.replace({}).range(item.from + 1 + index, item.from + 2 + index)); index++;
					}
				}
			}
		}
		return { decorations: Decoration.set(ranges, true), nativeOwners: Decoration.set(nativeOwners, true), active };
	}
	return [createInputStateExtension(), createInlineRevealPointerExtension(), createRenderedSourceClickExtension(), createNativeDecorationOwnership(), normalizeRenderedEdges,
		nativeInlineOwnership.of((state, view) => {
			if (!options.isActive(view)) return null;
			const settings = options.getSettings();
			const owned = [...state.field(shorthandRanges).filter(item => settings[item.kind]), ...(settings.subscript ? state.field(tildeRuns) : [])];
			return (from, to, decoration) => isNativeReplacement(decoration) && owned.some(item => item.from <= from && to <= item.to);
		}), shorthandSettings.of(() => options.getSettings()), shorthandRanges, tildeRuns, Prec.highest(ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		nativeOwners: DecorationSet;
		destroyed = false;
		pointerHeld = false;
		activeOwners: readonly InlineBodyOwner[] = [];
		frozenOwners: readonly InlineBodyOwner[] = [];
		readonly clickCleanups: readonly (() => void)[];
		constructor(readonly view: EditorView) {
			this.pointerHeld = inlineRevealPointerHeld(view.state);
			const projection = project(view, [], this.pointerHeld ? [] : undefined);
			this.decorations = projection.decorations;
			this.nativeOwners = projection.nativeOwners;
			this.activeOwners = projection.active;
			presentation.set(view.state, { active: this.activeOwners, view });
			this.clickCleanups = (['subscript', 'superscript', 'strikethrough'] as const).map(kind => bindRenderedSourceClick(view, view.contentDOM, (node, offset) => {
				const element = node.nodeType === 1 ? node as Element : node.parentElement;
				const body = element?.closest('.paraflow-inline-body');
				if (!body?.classList.contains(`paraflow-inline-body--${kind}`) || body.closest('.cm-editor') !== view.dom) return null;
				const position = view.posAtDOM(node, offset);
				return [...view.state.field(shorthandRanges), ...view.state.field(tildeRuns).flatMap(run => run.parts)]
					.some(item => item.kind === kind && item.from <= position && position <= item.to)
					? position : null;
			}, () => !this.destroyed && !view.compositionStarted && !requireCompositionState(view.state) && options.isActive(view) && options.getSettings()[kind === 'strikethrough' ? 'subscript' : kind]));
			const active = options.isActive(view);
			queueMicrotask(() => { if (!this.destroyed && active !== options.isActive(view)) view.dispatch({}); });
		}
		update(update: ViewUpdate): void {
			const pointerHeld = inlineRevealPointerHeld(update.state);
			if (update.docChanged) {
				const map = (item: InlineBodyOwner): InlineBodyOwner => ({ ...item,
					from: update.changes.mapPos(item.from, 1), to: update.changes.mapPos(item.to, -1),
				});
				this.activeOwners = this.activeOwners.map(map); this.frozenOwners = this.frozenOwners.map(map);
			} else if (pointerHeld && !this.pointerHeld) this.frozenOwners = this.activeOwners;
			this.pointerHeld = pointerHeld;
			// Keep the established DOM boundaries while the native IME owns its text range.
			if (options.isActive(this.view) && (this.view.compositionStarted || this.view.composing || requireCompositionState(update.state))) {
				this.decorations = this.decorations.map(update.changes);
				this.nativeOwners = this.nativeOwners.map(update.changes);
				presentation.set(update.state, { active: this.activeOwners, view: this.view });
				return;
			}
			const projection = project(this.view, this.activeOwners, pointerHeld ? this.frozenOwners : undefined);
			this.decorations = projection.decorations; this.activeOwners = projection.active;
			this.nativeOwners = projection.nativeOwners;
			presentation.set(update.state, { active: this.activeOwners, view: this.view });
			if (pointerHeld) this.frozenOwners = projection.active;
		}
		destroy(): void { this.destroyed = true; for (const cleanup of this.clickCleanups) cleanup(); }
	}, { decorations: value => value.decorations,
		provide: plugin => EditorView.outerDecorations.of(view => view.plugin(plugin)!.nativeOwners) }))];
}

export { SHORTHAND_CSS } from './styles.js';
