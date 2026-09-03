import type { EditorSelection, EditorState } from '@codemirror/state';
import {
	analyzeSource,
	containingLine,
	itemAtPosition,
	type AnalyzedItem,
	type SourceAnalysis,
} from './context-analysis.js';
import { normalizeStructuralBoundary } from './context-boundaries.js';
import { buildListScope, buildOrdinaryScope } from './context-scopes.js';
import {
	buildSelectionFromAnalysis,
	selectionGate,
	selectionSnapshot,
} from './context-selection.js';
import { buildListTopology, buildProjectionContext } from './context-topology.js';
import type {
	ContextRuntime,
	ListContext,
	ListItemSyntax,
	NavigationContext,
	ProjectionListContext,
	SelectionContext,
} from './model.js';
import { enumerateListItems } from './syntax.js';

export { normalizeStructuralBoundary };
export type { StructuralBoundaryExpectation } from './context-boundaries.js';

function caretGate(state: EditorState, runtime: ContextRuntime): boolean {
	return runtime.selectionsCount === 1 && !runtime.imeComposing && state.selection.main.empty;
}

function caretZone(item: AnalyzedItem, position: number): ListContext['caretZone'] {
	if (item.block.content.from === item.block.content.to) return 'empty';
	if (position <= item.block.content.from) return 'start';
	return position >= item.block.content.to ? 'end' : 'middle';
}

function buildAnalyzedListContext(
	analysis: SourceAnalysis,
	item: AnalyzedItem,
	position: number,
	state: EditorState,
	runtime: ContextRuntime,
): ListContext {
	const topology = buildListTopology(analysis, item);
	return {
		caret: position,
		caretZone: caretZone(item, position),
		current: item.block,
		editScope: buildListScope(analysis, item.block, topology, position, runtime),
		selection: selectionSnapshot(state.selection),
		source: analysis.source,
		topology,
	};
}

function enumerateAnalysis(state: EditorState): SourceAnalysis {
	return analyzeSource(state, enumerateListItems(state));
}

export function buildListContext(
	state: EditorState,
	position: number,
	runtime: ContextRuntime,
): ListContext | null {
	if (!caretGate(state, runtime)) return null;
	const analysis = enumerateAnalysis(state);
	const item = itemAtPosition(analysis, position);
	return item ? buildAnalyzedListContext(analysis, item, position, state, runtime) : null;
}

function ordinaryNavigationContext(
	analysis: SourceAnalysis,
	position: number,
	state: EditorState,
	runtime: ContextRuntime,
): NavigationContext {
	const line = containingLine(analysis.lines, position);
	return {
		assoc: state.selection.main.assoc,
		caret: position,
		editScope: buildOrdinaryScope(analysis, position, runtime),
		kind: 'ordinary',
		line: { from: line.from, to: line.to },
		selection: selectionSnapshot(state.selection),
		source: analysis.source,
	};
}

export function buildNavigationContext(
	state: EditorState,
	position: number,
	runtime: ContextRuntime,
	assoc: NavigationContext['assoc'] = state.selection.main.assoc,
): NavigationContext | null {
	if (!caretGate(state, runtime)) return null;
	const analysis = enumerateAnalysis(state);
	const item = itemAtPosition(analysis, position);
	if (!item) return { ...ordinaryNavigationContext(analysis, position, state, runtime), assoc };
	const list = buildAnalyzedListContext(analysis, item, position, state, runtime);
	return { assoc, editScope: list.editScope, kind: 'list', list };
}

export function buildSelectionContext(
	state: EditorState,
	selection: EditorSelection,
	runtime: ContextRuntime,
): SelectionContext | null {
	if (!selectionGate(state, selection, runtime)) return null;
	return buildSelectionFromAnalysis(enumerateAnalysis(state), selection, runtime);
}

export function buildProjectionContexts(
	state: EditorState,
	items: readonly ListItemSyntax[],
): readonly ProjectionListContext[] {
	const analysis = analyzeSource(state, items);
	return analysis.items.map((item) => buildProjectionContext(analysis, item));
}
