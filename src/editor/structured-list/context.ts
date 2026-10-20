import { syntaxTreeAvailable } from '@codemirror/language';
import type { EditorSelection, EditorState } from '@codemirror/state';
import {
	analyzeSource,
	containingLine,
	ownedBodyStart,
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
	OwnedBlock,
	ProjectionListContext,
	SelectionContext,
	SourceRange,
} from './model.js';
import { buildProjectionOwnedLines } from './projection-owned-lines.js';
import { discoverListItem, enumerateListItems } from './syntax.js';

export { normalizeStructuralBoundary };
export type { StructuralBoundaryExpectation } from './context-boundaries.js';

function caretGate(state: EditorState, runtime: ContextRuntime): boolean {
	return runtime.selectionMode === 'caret' && runtime.selectionsCount === 1 &&
		!runtime.imeComposing && state.selection.main.empty;
}

function navigationGate(state: EditorState, runtime: ContextRuntime): boolean {
	return caretGate(state, runtime) || (runtime.operation === 'up-down' &&
		runtime.selectionMode === 'continuous' && runtime.selectionsCount === 1 && !runtime.imeComposing);
}

function caretZone(content: SourceRange, position: number): ListContext['caretZone'] {
	if (content.from === content.to) return 'empty';
	if (position <= content.from) return 'start';
	return position >= content.to ? 'end' : 'middle';
}

function consecutiveParagraphLines(left: OwnedBlock, right: OwnedBlock): boolean {
	return left.kind !== 'descendant' && left.kind !== 'code-leaf' && right.kind !== 'descendant' && right.kind !== 'code-leaf' &&
		left.range.to + 1 === right.range.from;
}

function paragraphSubtreeIndexes(
	blocks: ListContext['topology']['ownedBlocks'],
	activeIndex: number,
): readonly number[] {
	let first = activeIndex;
	let last = activeIndex;
	while (first > 0 && consecutiveParagraphLines(blocks[first - 1]!, blocks[first]!)) first -= 1;
	while (last + 1 < blocks.length && consecutiveParagraphLines(blocks[last]!, blocks[last + 1]!)) last += 1;
	// Structural membership includes code leaves inside descendants, independent of paragraph ownership.
	while (last + 1 < blocks.length && blocks[last + 1]!.relativeDepth > 0) last += 1;
	return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function buildAnalyzedListContext(
	analysis: SourceAnalysis,
	item: AnalyzedItem,
	position: number,
	state: EditorState,
	runtime: ContextRuntime,
): ListContext {
	const topology = buildListTopology(analysis, item);
	const ownedBlockIndex = topology.ownedBlocks.findIndex((block) =>
		block.kind !== 'descendant' && block.kind !== 'code-leaf' && block.range.from <= position && position <= block.range.to);
	const owned = topology.ownedBlocks[ownedBlockIndex];
	const caretContent: ListContext['caretContent'] = owned && owned.kind !== 'descendant' && owned.kind !== 'code-leaf'
		? {
			kind: owned.kind,
			ownedBlockIndex,
			subtreeBlockIndexes: paragraphSubtreeIndexes(topology.ownedBlocks, ownedBlockIndex),
			range: { from: ownedBodyStart(containingLine(analysis.lines, owned.range.from)), to: owned.range.to },
		}
		: { kind: 'marker-line', ownedBlockIndex: null, subtreeBlockIndexes: [], range: item.block.content };
	return {
		caret: position,
		caretContent,
		caretZone: caretZone(caretContent.range, position),
		current: item.block,
		editScope: buildListScope(analysis, item.block, topology, position, runtime, caretContent),
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
	if (containingLine(analysis.lines, position).codeLeaf) return null;
	const item = itemAtPosition(analysis, position);
	return item && discoverListItem(state, position)
		? buildAnalyzedListContext(analysis, item, position, state, runtime)
		: null;
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
	if (!navigationGate(state, runtime)) return null;
	const analysis = enumerateAnalysis(state);
	const item = itemAtPosition(analysis, position);
	if (!item || containingLine(analysis.lines, position).codeLeaf) return { ...ordinaryNavigationContext(analysis, position, state, runtime), assoc };
	const list = buildAnalyzedListContext(analysis, item, position, state, runtime);
	if (!discoverListItem(state, position) && list.caretContent.kind === 'marker-line') return null;
	return { assoc, editScope: list.editScope, kind: 'list', list };
}

export function buildSelectionContext(
	state: EditorState,
	selection: EditorSelection,
	runtime: ContextRuntime,
): SelectionContext | null {
	if (!selectionGate(state, selection, runtime)) return null;
	const context = buildSelectionFromAnalysis(enumerateAnalysis(state), selection, runtime);
	return context.segments.some((segment) => segment.kind === 'list-content') ? context : null;
}

export function buildProjectionContexts(
	state: EditorState,
	items: readonly ListItemSyntax[],
): readonly ProjectionListContext[] {
	const analysis = analyzeSource(state, items);
	const ownedLines = buildProjectionOwnedLines(
		analysis,
		syntaxTreeAvailable(state, state.doc.length),
	);
	return analysis.items.map((item, index) =>
		buildProjectionContext(analysis, item, ownedLines[index] ?? []));
}
