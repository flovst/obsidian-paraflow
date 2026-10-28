import { createDetachedEl } from '../../dom';
import { syntaxTree } from '@codemirror/language';
import { Facet, Prec, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import { discoverParagraphAuthority } from './syntax.js';
import { createNativeDecorationOwnership, isNativeReplacement, nativeBlockOwnership } from '../runtime/native-decoration-ownership.js';

class ThematicBreakWidget extends WidgetType {
	eq(other: WidgetType): boolean { return other instanceof ThematicBreakWidget; }
	ignoreEvent(): boolean { return false; }
	toDOM(view: EditorView): HTMLElement {
		const rule = createDetachedEl(view.dom.ownerDocument, 'hr');
		rule.className = 'paraflow-thematic-break-rule';
		rule.setAttribute('role', 'separator');
		return rule;
	}
}

interface ThematicBreakProjection {
	readonly tree: Tree;
	readonly decorations: DecorationSet;
	readonly containerRanges: readonly ThematicBreakRange[];
	readonly ranges: readonly ThematicBreakRange[];
}

export interface ThematicBreakRange { readonly from: number; readonly to: number }
export const containerThematicBreaks = Facet.define<(state: EditorState) => readonly ThematicBreakRange[]>();

function containerRanges(state: EditorState): readonly ThematicBreakRange[] {
	return state.facet(containerThematicBreaks).flatMap(provider => provider(state));
}

function buildProjection(state: EditorState, nested = containerRanges(state)): ThematicBreakProjection {
	const decorations: Range<Decoration>[] = [];
	const blocks = [...discoverParagraphAuthority(state).blocks.filter(block => block.kind === 'thematic-break'),
		...nested];
	for (const block of blocks) {
		decorations.push(Decoration.line({ class: 'paraflow-thematic-break-line' }).range(state.doc.lineAt(block.from).from));
		decorations.push(Decoration.replace({ widget: new ThematicBreakWidget() }).range(block.from, block.to));
	}
	return { tree: syntaxTree(state), decorations: Decoration.set(decorations, true), containerRanges: nested, ranges: blocks };
}

const thematicBreakField = StateField.define<ThematicBreakProjection>({
	create: buildProjection,
	update(value, transaction) {
		const nested = containerRanges(transaction.state);
		return transaction.docChanged || transaction.reconfigured || value.tree !== syntaxTree(transaction.state) ||
			nested.length !== value.containerRanges.length || nested.some((range, index) =>
				range.from !== value.containerRanges[index]!.from || range.to !== value.containerRanges[index]!.to)
			? buildProjection(transaction.state, nested) : value;
	},
});

export function createThematicBreakProjection(isActive: (view: EditorView) => boolean): Extension {
	return [
		thematicBreakField,
		createNativeDecorationOwnership(), nativeBlockOwnership.of((state, view) => {
			if (!isActive(view)) return null;
			const ranges = state.field(thematicBreakField).ranges;
			return (from, to, decoration) => !!(decoration.spec as { block?: boolean }).block && isNativeReplacement(decoration) &&
				ranges.some(range => range.from === from && range.to === to);
		}),
		Prec.highest(EditorView.decorations.of(view => isActive(view)
			? view.state.field(thematicBreakField).decorations : Decoration.none)),
		Prec.highest(EditorView.domEventHandlers({
			mousedown(event, view) {
				const ownerWindow = view.dom.ownerDocument.defaultView!;
				if (!isActive(view) || event.button !== 0 || !(event.target instanceof ownerWindow.Element) ||
					!event.target.closest('.paraflow-thematic-break-line')) return false;
				event.preventDefault();
				return true;
			},
		})),
		EditorView.baseTheme({
			'.cm-line.paraflow-thematic-break-line': {
				minHeight: '0 !important', lineHeight: '0 !important', fontSize: '0 !important',
			},
			'.paraflow-thematic-break-rule': {
				display: 'block', width: '100%',
			},
			'&.cm-editor .cm-scroller .cm-content .cm-line.paraflow-thematic-break-line > .paraflow-thematic-break-rule': {
				// Semantic gap rows own spacing, including imported !important HR margins.
				margin: '0 !important',
			},
		}),
	];
}
