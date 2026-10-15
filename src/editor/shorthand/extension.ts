import { Prec, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { classifyCurrentSelectionMode, createInputStateExtension } from '../runtime/input-state.js';
import { createInlineRevealPointerExtension, inlineEndpointOwners, inlineRevealPointerHeld, type InlineBodyOwner } from '../runtime/inline-reveal.js';
import { discoverShorthand, type ShorthandRange, type ShorthandSettings } from './syntax.js';
import { shorthandSettings, tildeRuns, TildeRunWidget } from './tilde-run.js';
import { bindRenderedSourceClick, createRenderedSourceClickExtension } from '../runtime/rendered-source-click.js';
import { createNativeDecorationOwnership, nativeInlineOwnership, isNativeReplacement } from '../runtime/native-decoration-ownership.js';

const shorthandRanges = StateField.define<readonly ShorthandRange[]>({
	create: state => discoverShorthand(state.doc.toString()),
	update: (value, transaction) => transaction.docChanged ? discoverShorthand(transaction.newDoc.toString()) : value,
});

export function createShorthandExtension(options: { isActive(view: EditorView): boolean; getSettings(): ShorthandSettings }): Extension {
	function project(view: EditorView, composing: boolean, previousActive: readonly InlineBodyOwner[], frozenActive?: readonly InlineBodyOwner[]): {
		decorations: DecorationSet; active: readonly InlineBodyOwner[];
	} {
		if (!options.isActive(view) || composing || view.composing) return { decorations: Decoration.none, active: [] };
		const settings = options.getSettings();
		const ranges: Range<Decoration>[] = [];
		const visible = (item: { from: number; to: number }) => view.visibleRanges.some(range => range.from <= item.to && range.to >= item.from);
		const owners: InlineBodyOwner[] = [
			...view.state.field(shorthandRanges).filter(item => settings[item.kind] && visible(item)).map(item => ({
				from: item.from, to: item.to, bodies: [{ from: item.from + 1, to: item.to - 1 }],
			})),
			...(settings.subscript ? view.state.field(tildeRuns).filter(visible).map(run => ({
				from: run.from, to: run.to, bodies: run.parts.map(part => ({ from: part.bodyFrom, to: part.bodyTo })),
			})) : []),
		];
		const matching = (items: readonly InlineBodyOwner[]) => owners.filter(owner => items.some(item => item.from === owner.from && item.to === owner.to));
		const endpoints = inlineEndpointOwners(view.state, owners);
		const mode = classifyCurrentSelectionMode(view.state);
		const caret = view.state.selection.main;
		const synchronized = (mode === 'caret' || mode === 'unknown') && view.state.selection.ranges.length === 1 && caret.empty
			? previousActive.filter(item => item.from <= caret.head && caret.head <= item.to) : [];
		const active = frozenActive ? matching(frozenActive) : endpoints.length > 0 ? endpoints : matching(synchronized);
		const revealed = (item: { from: number; to: number }) => active.some(owner => owner.from === item.from && owner.to === item.to);
		if (settings.subscript) for (const run of view.state.field(tildeRuns)) {
			if (!view.visibleRanges.some(visible => visible.from <= run.to && visible.to >= run.from)) continue;
			if (revealed(run)) {
				ranges.push(Decoration.mark({ class: 'paraflow-invalid-native-strike' }).range(run.from, run.to));
				for (const part of run.parts) {
					const marker = Decoration.mark({ class: 'paraflow-inline-source-active' });
					ranges.push(marker.range(part.from, part.bodyFrom), marker.range(part.bodyTo, part.to));
					ranges.push(Decoration.mark({ class: `paraflow-inline-body paraflow-inline-body--${part.kind}` })
						.range(part.kind === 'subscript' ? part.from : part.bodyFrom, part.kind === 'subscript' ? part.to : part.bodyTo));
				}
			}
			else ranges.push(Decoration.replace({ widget: new TildeRunWidget(run, view.state.sliceDoc(run.from, run.to), () => options.isActive(view)) }).range(run.from, run.to));
		}
		for (const item of view.state.field(shorthandRanges)) {
			if (!settings[item.kind] || !view.visibleRanges.some(visible => visible.from <= item.to && visible.to >= item.from)) continue;
			const isRevealed = revealed(item);
			const marker = isRevealed ? Decoration.mark({ class: 'paraflow-inline-source-active' }) : Decoration.replace({});
			ranges.push(marker.range(item.from, item.from + 1), marker.range(item.to - 1, item.to));
			ranges.push(Decoration.mark({ class: `paraflow-inline-body paraflow-inline-body--${item.kind}` }).range(item.from, item.to));
			if (!isRevealed) {
				const body = view.state.sliceDoc(item.from + 1, item.to - 1);
				for (let index = 0; index < body.length - 1; index++) {
					if (body[index] === '\\' && /[ \t!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/u.test(body[index + 1]!)) {
						ranges.push(Decoration.replace({}).range(item.from + 1 + index, item.from + 2 + index)); index++;
					}
				}
			}
		}
		return { decorations: Decoration.set(ranges, true), active };
	}
	return [createInputStateExtension(), createInlineRevealPointerExtension(), createRenderedSourceClickExtension(), createNativeDecorationOwnership(),
		nativeInlineOwnership.of((state, view) => {
			if (!options.isActive(view)) return null;
			const settings = options.getSettings();
			const owned = [...state.field(shorthandRanges).filter(item => settings[item.kind]), ...(settings.subscript ? state.field(tildeRuns) : [])];
			return (from, to, decoration) => isNativeReplacement(decoration) && owned.some(item => item.from <= from && to <= item.to);
		}), shorthandSettings.of(() => options.getSettings()), shorthandRanges, tildeRuns, Prec.highest(ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		composing = false;
		destroyed = false;
		pointerHeld = false;
		activeOwners: readonly InlineBodyOwner[] = [];
		frozenOwners: readonly InlineBodyOwner[] = [];
		readonly clickCleanups: readonly (() => void)[];
		constructor(readonly view: EditorView) {
			this.pointerHeld = inlineRevealPointerHeld(view.state);
			const projection = project(view, false, [], this.pointerHeld ? [] : undefined);
			this.decorations = projection.decorations;
			this.activeOwners = projection.active;
			this.clickCleanups = (['subscript', 'superscript'] as const).map(kind => bindRenderedSourceClick(view, view.contentDOM, (node, offset) => {
				const element = node.nodeType === 1 ? node as Element : node.parentElement;
				const body = element?.closest('.paraflow-inline-body');
				if (!body?.classList.contains(`paraflow-inline-body--${kind}`) || body.closest('.cm-editor') !== view.dom) return null;
				const position = view.posAtDOM(node, offset);
				return view.state.field(shorthandRanges).some(item => item.kind === kind && item.from <= position && position <= item.to)
					? position : null;
			}, () => !this.destroyed && !this.composing && options.isActive(view) && options.getSettings()[kind]));
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
			const projection = project(this.view, this.composing, this.activeOwners, pointerHeld ? this.frozenOwners : undefined);
			this.decorations = projection.decorations; this.activeOwners = projection.active;
			if (pointerHeld) this.frozenOwners = projection.active;
		}
		destroy(): void { this.destroyed = true; for (const cleanup of this.clickCleanups) cleanup(); }
	}, { decorations: value => value.decorations, eventHandlers: {
		compositionstart() { this.composing = true; this.view.dispatch({}); },
		compositionend() { this.composing = false; this.view.dispatch({}); },
	} }))];
}

export const SHORTHAND_CSS = `
.paraflow-inline-body--subscript, .paraflow-inline-body--superscript { font-size: .75em; line-height: 0; position: relative; vertical-align: baseline; }
.paraflow-inline-body--subscript { bottom: -.25em; }
.paraflow-inline-body--superscript { top: -.5em; }
`;
