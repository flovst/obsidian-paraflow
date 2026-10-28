import { isolateHistory } from '@codemirror/commands';
import { EditorSelection, Prec, type EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
import { discoverParagraphAuthority } from './paragraph/syntax.js';
import { enumerateListItems } from './structured-list/syntax.js';
import { hasListGroupBoundary } from './structured-list/group-boundary.js';
import { quoteContainers } from './callout/presentation-model.js';
import { projectQuoteContent } from './callout/projection.js';
import { codeBlockEdit, discoverCodeBlocks } from './code-blocks/model.js';
import { codeBlocksIn } from './code-blocks/source-scan.js';
import { discoverMath } from './math/syntax.js';
import { mathBlockEdit } from './math/operations.js';
import { compositionStateField, selectionModeAnnotation } from './runtime/input-state.js';
import { detailsContainers } from './rendered-blocks/details-source.js';
import { documentBodyStart } from './runtime/virtual-tail.js';
import type { RegisterBlockMoveScope } from './block-move-scope.js';

interface Unit { readonly from: number; readonly to: number }
interface MoveScope { readonly units: readonly Unit[]; readonly delegated?: boolean }

function physicalUnit(state: EditorState, range: Unit): Unit {
	return { from: state.doc.lineAt(range.from).from, to: state.doc.lineAt(range.to).to };
}

function contains(unit: Unit, range: Unit): boolean { return unit.from <= range.from && range.to <= unit.to; }

/** The deepest shared owner chooses rows, list items or body blocks. */
function movementScope(state: EditorState, range: Unit, direction: -1 | 1): MoveScope {
	const code = [...discoverCodeBlocks(state), ...codeBlocksIn(state.doc, true)].find(block => contains(block, range));
	if (code && !contains(range, code)) return { units: code.lines.map(line => physicalUnit(state, line)) };
	const math = discoverMath(state).find(block => block.display && contains(block, range));
	if (math && !contains(range, math)) {
		const first = state.doc.lineAt(math.from).number + 1, last = state.doc.lineAt(math.to).number - 1;
		return { units: Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => state.doc.line(first + index)) };
	}
	const card = quoteContainers(state).filter(card => contains(card, range) && !contains(range, card)).sort((a, b) => b.depth - a.depth)[0];
	if (card) {
		if (card.kind === 'callout' && range.from <= card.headerTo) return { units: [] };
		const projection = projectQuoteContent(state, card.kind === 'callout' ? card.headerTo + 1 : card.from, card.to, card.depth)!;
		const toVirtual = (position: number): number => {
			const line = projection.lines.find(line => line.from <= position && position <= line.from + line.prefix.length + line.text.length)!;
			return line.virtualFrom + Math.max(0, position - line.from - line.prefix.length);
		};
		const inner = movementScope(projection.state, { from: toVirtual(range.from), to: toVirtual(range.to) }, direction);
		return { ...inner, units: inner.units.map(unit => physicalUnit(state, { from: projection.toSource(unit.from), to: projection.toSource(unit.to) })) };
	}
	const items = enumerateListItems(state);
	let current = items.filter(item => contains(physicalUnit(state, item.itemNode), { from: range.from, to: range.from }))
		.sort((a, b) => a.itemNode.to - a.itemNode.from - (b.itemNode.to - b.itemNode.from))[0];
	if (current) {
		const parentOf = (child: NonNullable<typeof current>) => items.filter(item => item !== child && contains(item.itemNode, child.itemNode))
			.sort((a, b) => a.itemNode.to - a.itemNode.from - (b.itemNode.to - b.itemNode.from))[0];
		let parent = parentOf(current);
		while (parent && !contains(physicalUnit(state, parent.itemNode), range)) { current = parent; parent = parentOf(current); }
		if (parent) {
			const descendants = items.filter(item => item !== parent && contains(parent.itemNode, item.itemNode));
			return { units: descendants.filter(item => !descendants.some(other => other !== item && contains(other.itemNode, item.itemNode)))
				.map(item => physicalUnit(state, item.itemNode)) };
		}
	}
	const blocks = discoverParagraphAuthority(state).blocks;
	if (blocks.some(block => block.kind === 'table' && contains(block, range))) return { units: [], delegated: true };
	const source = state.sliceDoc(), details = detailsContainers(source);
	const enclosing = details.filter(block => contains(block, range) && !contains(range, block))
		.sort((a, b) => a.to - a.from - (b.to - b.from))[0];
	if (enclosing && (range.from < enclosing.bodyFrom || range.to >= enclosing.bodyTo)) return { units: [] };
	const nested = details.filter(block => !enclosing || block.from >= enclosing.bodyFrom && block.to < enclosing.bodyTo);
	const wholeDetails = nested.filter(block => !nested.some(parent => parent !== block && contains(parent, block)));
	// Frontmatter remains a document attribute when the first body block moves.
	const metadataEnd = documentBodyStart(state);
	const units = blocks.filter(block => block.from >= metadataEnd &&
		(!enclosing || block.from >= enclosing.bodyFrom && block.to < enclosing.bodyTo) &&
		!wholeDetails.some(details => block.from < details.to && details.from < block.to));
	const grouped: Unit[] = [];
	let previousList: typeof items[number] | undefined;
	for (const block of units) {
		const item = block.kind === 'list-item' ? items.find(item => physicalUnit(state, item.itemNode).from === block.from) : undefined;
		const previous = grouped.at(-1);
		if (item && previousList && previous &&
			(item.prefix.orderedValue === null) === (previousList.prefix.orderedValue === null) &&
			/^\s*$/u.test(source.slice(previous.to, block.from)) && !hasListGroupBoundary(source, previous.to, block.from)) {
			grouped[grouped.length - 1] = { from: previous.from, to: block.to };
		} else grouped.push(block);
		previousList = item;
	}
	if (current) {
		const group = grouped.find(block => contains(block, range));
		if (group) {
			const siblings = units.filter(block => block.kind === 'list-item' && contains(group, block)).map(block => physicalUnit(state, block));
			const first = siblings.findIndex(block => block.from <= range.from && range.from <= block.to);
			const last = siblings.findIndex(block => block.from <= range.to && range.to <= block.to);
			// Within a list, move items. At its outer edge, move the complete list.
			if (first >= 0 && last >= first && (direction < 0 ? first > 0 : last < siblings.length - 1)) return { units: siblings };
		}
	}
	return { units: [...grouped, ...wholeDetails].map(block => physicalUnit(state, block)).sort((a, b) => a.from - b.from) };
}

export function planBlockMove(state: EditorState, direction: -1 | 1): TransactionSpec | null | false {
	if (state.selection.ranges.length !== 1) return null;
	const selection = state.selection.main;
	// An exclusive selection endpoint at a line start belongs to the previous row.
	const to = !selection.empty && state.doc.lineAt(selection.to).from === selection.to ? selection.to - 1 : selection.to;
	const scope = movementScope(state, { from: selection.from, to }, direction);
	if (scope.delegated) return false;
	const first = scope.units.findIndex(unit => unit.from <= selection.from && selection.from <= unit.to);
	const last = scope.units.findIndex(unit => unit.from <= to && to <= unit.to);
	if (first < 0 || last < first) return null;
	const neighbor = scope.units[direction < 0 ? first - 1 : last + 1];
	if (!neighbor) return null;
	const moving = { from: scope.units[first]!.from, to: scope.units[last]!.to };
	const left = direction < 0 ? neighbor : moving, right = direction < 0 ? moving : neighbor;
	const separator = state.sliceDoc(left.to, right.from);
	const insert = state.sliceDoc(right.from, right.to) + separator + state.sliceDoc(left.from, left.to);
	const offset = direction < 0 ? left.from - right.from : right.to - left.to;
	return {
		changes: { from: left.from, to: right.to, insert },
		selection: EditorSelection.range(Math.min(state.doc.length, selection.anchor + offset), Math.min(state.doc.length, selection.head + offset)),
		userEvent: 'move.block', scrollIntoView: true,
		annotations: [isolateHistory.of('full'), codeBlockEdit.of(true), mathBlockEdit.of(true), selectionModeAnnotation.of('normal')],
	};
}

export function createBlockMoveExtension(isActive: (view: EditorView) => boolean, registerScope?: RegisterBlockMoveScope): Extension {
	const move = (direction: -1 | 1) => (view: EditorView): boolean => {
		if (!isActive(view) || view.composing || view.state.field(compositionStateField, false)) return false;
		const plan = planBlockMove(view.state, direction);
		if (plan === false) return false;
		if (plan) view.dispatch(plan);
		// Consume container-edge keys before native physical-line movement.
		return true;
	};
	return [
		registerScope ? ViewPlugin.define(view => {
			const release = registerScope(view, event => event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
				(event.key === 'ArrowUp' || event.key === 'ArrowDown') && move(event.key === 'ArrowUp' ? -1 : 1)(view));
			return { destroy: release };
		}) : [],
		Prec.highest(keymap.of([{ key: 'Alt-ArrowUp', run: move(-1) }, { key: 'Alt-ArrowDown', run: move(1) }])),
	];
}
