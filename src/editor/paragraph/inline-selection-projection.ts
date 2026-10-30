import { syntaxTreeAvailable } from '@codemirror/language';
import { mathSyntaxTree as syntaxTree } from '../math/semantic-tree.js';
import {
	EditorSelection,
	Prec,
	type ChangeDesc,
	type EditorState,
	type Extension,
	type SelectionRange,
	type Text,
} from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { inlineHtmlConstruct, InlineHtmlWidget, type InlineHtmlRenderer } from './inline-html.js';
import { LiteralStrikeWidget, malformedNativeStrikeRanges } from './malformed-native-strike.js';
import { unresolvedShortcutReferences } from './literal-reference.js';
import { ownsTildeRun, shorthandSettings } from '../shorthand/tilde-run.js';
import { contentSyntaxTree } from '../callout/projection.js';
import { pendingMathAt, pendingMathRanges, type PendingMathRange } from '../math/candidate-ranges.js';
export type { InlineHtmlRenderer } from './inline-html.js';
import { classifyCurrentSelectionMode } from '../runtime/input-state.js';
import { createRenderedSourceClickExtension } from '../runtime/rendered-source-click.js';
import { createInlineRevealPointerExtension, inlineEndpointOwners, inlineRevealPointerHeld } from '../runtime/inline-reveal.js';
import { createNativeDecorationOwnership, nativeBlockOwnership, nativeInlineOwnership, isNativeReplacement } from '../runtime/native-decoration-ownership.js';

export const ACTIVE_INLINE_SOURCE_CLASS = 'paraflow-inline-source-active';
export const INLINE_BODY_CLASS = 'paraflow-inline-body';

export type InlineSelectionSourceKind = 'delimiter' | 'link-destination';

export type InlineSemanticConstructKind =
	| 'emphasis'
	| 'strong'
	| 'strong-emphasis'
	| 'highlight'
	| 'inline-code'
	| 'strikethrough'
	| 'literal-strike'
	| 'escape'
	| 'wikilink'
	| 'inline-html'
	| 'link';

export interface InlineSelectionSourceRange {
	readonly from: number;
	readonly kind: InlineSelectionSourceKind;
	readonly to: number;
}

export interface InlineSemanticConstruct {
	readonly editFrom: number;
	readonly editTo: number;
	readonly kind: InlineSemanticConstructKind;
	readonly sourceRanges: readonly InlineSelectionSourceRange[];
	readonly htmlBodies?: readonly { readonly from: number; readonly to: number; readonly tagName: string }[];
}

interface SourceSpan {
	readonly from: number;
	readonly to: number;
}

interface DiscoveryContext {
	readonly flatLinks: Map<string, FlatLinkAnalysis>;
	readonly indexedFlatLinkLines: Set<string>;
	readonly inlineLinks: Map<string, InlineSemanticConstruct | null>;
	readonly standardBracketOwners: Map<string, SourceSpanIndex>;
	readonly unsupportedFlatHosts: SourceSpanIndex;
}

interface FlatLinkAnalysis {
	readonly construct: InlineSemanticConstruct | null;
	readonly unsupportedSpan: SourceSpan | null;
}

class SourceSpanIndex {
	private readonly prefixMaxTo: number[] = [];
	private readonly spans: SourceSpan[] = [];

	add(span: SourceSpan): void {
		const last = this.spans.at(-1);
		if (!last || last.from <= span.from) {
			this.spans.push(span);
			this.prefixMaxTo.push(Math.max(this.prefixMaxTo.at(-1) ?? 0, span.to));
			return;
		}
		let low = 0;
		let high = this.spans.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (this.spans[middle]!.from <= span.from) low = middle + 1;
			else high = middle;
		}
		this.spans.splice(low, 0, span);
		this.prefixMaxTo.splice(low, 0, span.to);
		for (let index = low; index < this.spans.length; index += 1) {
			this.prefixMaxTo[index] = Math.max(
				this.prefixMaxTo[index - 1] ?? 0,
				this.spans[index]!.to,
			);
		}
	}

	contains(from: number, to: number): boolean {
		let low = 0;
		let high = this.spans.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (this.spans[middle]!.from <= from) low = middle + 1;
			else high = middle;
		}
		return low > 0 && this.prefixMaxTo[low - 1]! >= to;
	}
}

function nameTokens(name: string): readonly string[] {
	return name.toLowerCase().split(/[\s_]+/u);
}

function directChildren(node: SyntaxNode): readonly SyntaxNode[] {
	const children: SyntaxNode[] = [];
	for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
	return children;
}

function delimiterRange(node: SyntaxNode): InlineSelectionSourceRange {
	return { from: node.from, kind: 'delimiter', to: node.to };
}

function edgeRanges(
	node: SyntaxNode,
	width: number,
): readonly InlineSelectionSourceRange[] {
	return [
		{ from: node.from, kind: 'delimiter', to: node.from + width },
		{ from: node.to - width, kind: 'delimiter', to: node.to },
	];
}

function construct(
	node: SyntaxNode,
	kind: InlineSemanticConstructKind,
	sourceRanges: readonly InlineSelectionSourceRange[],
): InlineSemanticConstruct | null {
	if (sourceRanges.length === 0 || sourceRanges.some((range) => range.from >= range.to)) return null;
	return {
		editFrom: node.from,
		editTo: node.to,
		kind,
		sourceRanges,
	};
}

function directMarkRanges(
	node: SyntaxNode,
	markName: string,
): readonly InlineSelectionSourceRange[] {
	return directChildren(node)
		.filter((child) => child.name === markName)
		.map(delimiterRange);
}

function mergeSourceRanges(
	ranges: readonly InlineSelectionSourceRange[],
): readonly InlineSelectionSourceRange[] {
	const ordered = [...ranges].sort((left, right) =>
		left.from - right.from || left.to - right.to);
	const merged: InlineSelectionSourceRange[] = [];
	for (const range of ordered) {
		const previous = merged.at(-1);
		if (!previous || previous.to <= range.from || previous.kind !== range.kind) {
			merged.push(range);
			continue;
		}
		merged[merged.length - 1] = {
			from: previous.from,
			kind: previous.kind,
			to: Math.max(previous.to, range.to),
		};
	}
	return merged;
}

function mergeAdjacentDelimiterRanges(
	ranges: readonly InlineSelectionSourceRange[],
): readonly InlineSelectionSourceRange[] {
	const ordered = [...ranges].sort((left, right) => left.from - right.from);
	const merged: InlineSelectionSourceRange[] = [];
	for (const range of ordered) {
		const previous = merged.at(-1);
		if (!previous || previous.to < range.from) {
			merged.push(range);
			continue;
		}
		merged[merged.length - 1] = {
			from: previous.from,
			kind: 'delimiter',
			to: Math.max(previous.to, range.to),
		};
	}
	return merged;
}

function combinedStrongEmphasis(node: SyntaxNode): InlineSemanticConstruct | null {
	if (node.name !== 'Emphasis' && node.name !== 'StrongEmphasis') return null;
	const innerName = node.name === 'Emphasis' ? 'StrongEmphasis' : 'Emphasis';
	const children = directChildren(node);
	const inner = children.find((child) => child.name === innerName);
	if (!inner) return null;
	const outerMarks = directMarkRanges(node, 'EmphasisMark');
	const innerMarks = directMarkRanges(inner, 'EmphasisMark');
	if (outerMarks.length !== 2 || innerMarks.length !== 2) return null;
	if (inner.from !== outerMarks[0]!.to || inner.to !== outerMarks[1]!.from ||
		innerMarks[0]!.from !== inner.from || innerMarks[1]!.to !== inner.to) return null;
	return construct(
		node,
		'strong-emphasis',
		mergeAdjacentDelimiterRanges([...outerMarks, ...innerMarks]),
	);
}

function isNestedCombinedComponent(node: SyntaxNode): boolean {
	return (node.name === 'StrongEmphasis' || node.name === 'Emphasis') && node.parent !== null &&
		combinedStrongEmphasis(node.parent) !== null;
}

function hasUnsupportedLinkAncestor(
	state: EditorState,
	node: SyntaxNode,
	context: DiscoveryContext,
): boolean {
	for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
		if (ancestor.name === 'Image' || ancestor.name === 'Autolink') return true;
		if (isLinkContainer(ancestor) &&
			cachedInlineLinkConstruct(state, ancestor, context) === null) return true;
	}
	return false;
}

function isLinkContainer(node: SyntaxNode): boolean {
	if (node.name === 'Image' || node.name === 'Autolink') return false;
	return node.name === 'Link' || nameTokens(node.name).some((token) => token.includes('link'));
}

function isLinkDelimiter(node: SyntaxNode): boolean {
	if (node.name === 'LinkMark') return true;
	const tokens = nameTokens(node.name);
	return tokens.some((token) => token.startsWith('formatting-')) &&
		tokens.some((token) => token.includes('link'));
}

function isLinkDestination(node: SyntaxNode): boolean {
	return node.name === 'URL' || nameTokens(node.name).some((token) => token.includes('url'));
}

function isLinkTitle(node: SyntaxNode): boolean {
	return node.name === 'LinkTitle' || nameTokens(node.name).some((token) =>
		token === 'title' || token.endsWith('-title'));
}

function recognizedLinkDestination(
	state: EditorState,
	nodes: readonly SyntaxNode[],
	from: number,
	to: number,
	nodeFrom = 0,
	nodeTo = nodes.length,
): boolean {
	let cursor = from;
	let destinationSeen = false;
	let titleSeen = false;
	let whitespaceSinceValue = false;
	for (let index = nodeFrom; index < nodeTo; index += 1) {
		const node = nodes[index]!;
		if (node.to <= from || node.from >= to) continue;
		if (node.from < from || node.to > to || node.from < cursor) return false;
		const gap = state.sliceDoc(cursor, node.from);
		if (gap.trim() !== '') return false;
		if (gap.length > 0) whitespaceSinceValue = true;
		const source = state.sliceDoc(node.from, node.to);
		if (source.trim() === '') {
			whitespaceSinceValue = true;
			cursor = node.to;
			continue;
		}
		if (isLinkDestination(node) && !destinationSeen && !titleSeen) {
			destinationSeen = true;
			whitespaceSinceValue = false;
			cursor = node.to;
			continue;
		}
		if (isLinkTitle(node) && !titleSeen && whitespaceSinceValue) {
			titleSeen = true;
			whitespaceSinceValue = false;
			cursor = node.to;
			continue;
		}
		return false;
	}
	return state.sliceDoc(cursor, to).trim() === '';
}

function hasUnescapedBangBefore(state: EditorState, position: number): boolean {
	if (position === 0 || state.sliceDoc(position - 1, position) !== '!') return false;
	let backslashes = 0;
	for (let cursor = position - 2;
		cursor >= 0 && state.sliceDoc(cursor, cursor + 1) === '\\';
		cursor -= 1) backslashes += 1;
	return backslashes % 2 === 0;
}

function inlineLinkConstruct(
	state: EditorState,
	node: SyntaxNode,
): InlineSemanticConstruct | null {
	if (!isLinkContainer(node) || node.from >= node.to) return null;
	const children = directChildren(node);
	if (children.length === 0 ||
		(node.name !== 'Link' && hasUnescapedBangBefore(state, node.from))) return null;
	const delimiters = children.filter(isLinkDelimiter).map((child) => ({
		node: child,
		source: state.sliceDoc(child.from, child.to),
	}));
	const opening = delimiters.find(({ node: delimiter, source }) =>
		source === '[' && delimiter.from === node.from);
	const closing = [...delimiters].reverse().find(({ node: delimiter, source }) =>
		source === ')' && delimiter.to === node.to);
	if (!opening || !closing) return null;
	let closeLabel: InlineSelectionSourceRange | null = null;
	let openDestination: InlineSelectionSourceRange | null = null;
	for (let index = 0; index < delimiters.length; index += 1) {
		const current = delimiters[index]!;
		const next = delimiters[index + 1];
		if (current.source === '](' && current.node.from >= opening.node.to &&
			current.node.to <= closing.node.from) {
			closeLabel = { from: current.node.from, kind: 'delimiter', to: current.node.from + 1 };
			openDestination = {
				from: current.node.from + 1,
				kind: 'delimiter',
				to: current.node.to,
			};
			break;
		}
		if (current.source === ']' && next?.source === '(' &&
			current.node.to === next.node.from && current.node.from >= opening.node.to &&
			next.node.to <= closing.node.from) {
			closeLabel = delimiterRange(current.node);
			openDestination = delimiterRange(next.node);
			break;
		}
	}
	if (!closeLabel || !openDestination) return null;
	const destinationFrom = openDestination.to;
	const destinationTo = closing.node.from;
	if (!recognizedLinkDestination(state, children, destinationFrom, destinationTo)) return null;
	const sourceRanges: InlineSelectionSourceRange[] = [
		delimiterRange(opening.node),
		closeLabel,
		openDestination,
	];
	if (destinationFrom < destinationTo) {
		sourceRanges.push({
			from: destinationFrom,
			kind: 'link-destination',
			to: destinationTo,
		});
	}
	sourceRanges.push(delimiterRange(closing.node));
	return construct(node, 'link', sourceRanges);
}

function cachedInlineLinkConstruct(
	state: EditorState,
	node: SyntaxNode,
	context: DiscoveryContext,
): InlineSemanticConstruct | null {
	const key = `${node.type.id}:${node.from}:${node.to}`;
	if (context.inlineLinks.has(key)) return context.inlineLinks.get(key) ?? null;
	const item = inlineLinkConstruct(state, node);
	context.inlineLinks.set(key, item);
	return item;
}

function standardBracketOpaqueSpans(
	node: SyntaxNode,
	region: SourceSpan,
): readonly SourceSpan[] {
	let root = node.parent;
	while (root?.parent && root.name !== 'Paragraph') root = root.parent;
	if (!root) return [];
	const spans: SourceSpan[] = [];
	const visit = (parent: SyntaxNode): void => {
		for (let child = parent.childAfter(region.from);
			child && child.from < region.to;
			child = child.nextSibling) {
			if (child.to <= region.from) continue;
			if (child.name === 'Link' || child.name === 'Image' || child.name === 'InlineCode' ||
				child.name === 'Autolink' || child.name === 'HTMLTag') {
				spans.push({
					from: Math.max(child.from, region.from),
					to: Math.min(child.to, region.to),
				});
			} else {
				visit(child);
			}
		}
	};
	visit(root);
	return spans.sort((left, right) => left.from - right.from || left.to - right.to);
}

function standardBracketRegion(state: EditorState, node: SyntaxNode): SourceSpan {
	for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
		if (ancestor.name === 'Paragraph') return { from: ancestor.from, to: ancestor.to };
	}
	const line = state.doc.lineAt(node.from);
	return { from: line.from, to: line.to };
}

function hasStandardBracketOwner(
	state: EditorState,
	node: SyntaxNode,
	context: DiscoveryContext,
): boolean {
	const region = standardBracketRegion(state, node);
	if (node.from === region.from || node.to > region.to) return false;
	const regionKey = `${region.from}:${region.to}`;
	let owners = context.standardBracketOwners.get(regionKey);
	if (!owners) {
		owners = new SourceSpanIndex();
		const source = state.sliceDoc(region.from, region.to);
		const opaque = standardBracketOpaqueSpans(node, region);
		const openings: number[] = [];
		const pairs: SourceSpan[] = [];
		let backslashes = 0;
		let opaqueIndex = 0;
		for (let offset = 0; offset < source.length; offset += 1) {
			const position = region.from + offset;
			while (opaque[opaqueIndex] && opaque[opaqueIndex]!.to <= position) opaqueIndex += 1;
			const hidden = opaque[opaqueIndex];
			if (hidden && hidden.from <= position) {
				offset = hidden.to - region.from - 1;
				backslashes = 0;
				continue;
			}
			const character = source[offset]!;
			if (character === '\\') {
				backslashes += 1;
				continue;
			}
			const escaped = backslashes % 2 === 1;
			backslashes = 0;
			if (escaped) continue;
			if (character === '[') openings.push(position);
			else if (character === ']' && openings.length > 0) {
				pairs.push({ from: openings.pop()!, to: position + 1 });
			}
		}
		pairs.sort((left, right) => left.from - right.from || left.to - right.to);
		for (const pair of pairs) owners.add(pair);
		context.standardBracketOwners.set(regionKey, owners);
	}
	return owners.contains(node.from, node.to);
}

function indexFlatHypermdLinkLine(
	state: EditorState,
	node: SyntaxNode,
	context: DiscoveryContext,
): void {
	const none = { construct: null, unsupportedSpan: null } as const;
	const line = state.doc.lineAt(node.from);
	const parent = node.parent;
	const lineKey = `${parent?.type.id ?? -1}:${parent?.from ?? -1}:${parent?.to ?? -1}` +
		`:${line.from}:${line.to}`;
	if (context.indexedFlatLinkLines.has(lineKey)) return;
	context.indexedFlatLinkLines.add(lineKey);
	let first = node;
	while (first.prevSibling && first.prevSibling.to > line.from) first = first.prevSibling;
	const nodes: SyntaxNode[] = [];
	for (let candidate: SyntaxNode | null = first;
		candidate && candidate.from <= line.to;
		candidate = candidate.nextSibling) {
		if (candidate.to > line.from) nodes.push(candidate);
	}
	const sources = nodes.map((candidate) => isLinkDelimiter(candidate)
		? state.sliceDoc(candidate.from, candidate.to)
		: null);
	const openingIndexes: number[] = [];
	const bracketStack: number[] = [];
	const closeLabelByOpening = new Map<number, number>();
	for (let index = 0; index < nodes.length; index += 1) {
		if (sources[index] === '[') {
			openingIndexes.push(index);
			bracketStack.push(index);
		} else if ((sources[index] === ']' || sources[index] === '](') &&
			bracketStack.length > 0) {
			closeLabelByOpening.set(bracketStack.pop()!, index);
		}
	}
	const nextClosingParenthesis = new Array<number>(nodes.length).fill(-1);
	let closingIndex = -1;
	for (let index = nodes.length - 1; index >= 0; index -= 1) {
		if (sources[index] === ')') closingIndex = index;
		nextClosingParenthesis[index] = closingIndex;
	}
	for (const openingIndex of openingIndexes) {
		const opening = nodes[openingIndex]!;
		const cacheKey = `${opening.type.id}:${opening.from}:${opening.to}`;
		const closeLabelIndex = closeLabelByOpening.get(openingIndex);
		let analysis: FlatLinkAnalysis = none;
		if (closeLabelIndex !== undefined) {
			const closeLabel = nodes[closeLabelIndex]!;
			const mergedSeparator = sources[closeLabelIndex] === '](';
			const openDestinationIndex = mergedSeparator ? closeLabelIndex : closeLabelIndex + 1;
			const openDestination = nodes[openDestinationIndex];
			const hasDestinationOpening = openDestination !== undefined &&
				isLinkDelimiter(openDestination) &&
				(mergedSeparator || closeLabel.to === openDestination.from) &&
				(mergedSeparator || sources[openDestinationIndex] === '(');
			if (hasDestinationOpening) {
				const destinationStart = mergedSeparator ? closeLabel.to : openDestination.to;
				const destinationClosingIndex =
					nextClosingParenthesis[openDestinationIndex + 1] ?? -1;
				const closing = nodes[destinationClosingIndex];
				if (!closing || !recognizedLinkDestination(
					state,
					nodes,
					destinationStart,
					closing.from,
					openDestinationIndex + 1,
					destinationClosingIndex,
				)) {
					analysis = {
						construct: null,
						unsupportedSpan: { from: opening.from, to: closeLabel.to },
					};
				} else if (hasUnescapedBangBefore(state, opening.from)) {
					analysis = {
						construct: null,
						unsupportedSpan: { from: opening.from, to: closing.to },
					};
				} else {
					const sourceRanges: InlineSelectionSourceRange[] = [
						delimiterRange(opening),
						{ from: closeLabel.from, kind: 'delimiter', to: closeLabel.from + 1 },
						{
							from: mergedSeparator ? closeLabel.from + 1 : openDestination.from,
							kind: 'delimiter',
							to: destinationStart,
						},
					];
					if (destinationStart < closing.from) {
						sourceRanges.push({
							from: destinationStart,
							kind: 'link-destination',
							to: closing.from,
						});
					}
					sourceRanges.push(delimiterRange(closing));
					analysis = {
						construct: {
							editFrom: opening.from,
							editTo: closing.to,
							kind: 'link',
							sourceRanges,
						},
						unsupportedSpan: null,
					};
				}
			} else {
				const suffix = nodes[closeLabelIndex + 1];
				if (suffix && isLinkDelimiter(suffix) && suffix.from === closeLabel.to &&
					(sources[closeLabelIndex + 1] === '[' ||
						sources[closeLabelIndex + 1] === '(')) {
					analysis = {
						construct: null,
						unsupportedSpan: { from: opening.from, to: closeLabel.to },
					};
				}
			}
		}
		context.flatLinks.set(cacheKey, analysis);
		if (analysis.unsupportedSpan) context.unsupportedFlatHosts.add(analysis.unsupportedSpan);
	}
}

function cachedFlatHypermdLinkAnalysis(
	state: EditorState,
	node: SyntaxNode,
	context: DiscoveryContext,
): FlatLinkAnalysis {
	const key = `${node.type.id}:${node.from}:${node.to}`;
	const existing = context.flatLinks.get(key);
	if (existing) return existing;
	if (!isLinkDelimiter(node)) return { construct: null, unsupportedSpan: null };
	indexFlatHypermdLinkLine(state, node, context);
	return context.flatLinks.get(key) ?? { construct: null, unsupportedSpan: null };
}

function flatHypermdFormattingMarker(
	state: EditorState,
	node: SyntaxNode,
	knownSource?: string,
): { readonly delimiter: string; readonly kind: Exclude<InlineSemanticConstructKind, 'link'> } | null {
	const tokens = nameTokens(node.name);
	if (tokens.some((token) => token.includes('link'))) return null;
	if (!tokens.includes('inline-code') &&
		!tokens.some((token) => token.includes('highlight') || token.includes('strong') ||
			token.includes('emphasis') || token.includes('strikethrough') || token === 'em')) return null;
	const delimiter = knownSource ?? state.sliceDoc(node.from, node.to);
	const hasStrong = tokens.some((token) => token.includes('strong'));
	const hasEmphasis = tokens.some((token) => token.includes('emphasis') || token === 'em' ||
		token.endsWith('-em'));
	if (hasStrong && hasEmphasis && (delimiter === '***' || delimiter === '___')) {
		return { delimiter, kind: 'strong-emphasis' };
	}
	if (tokens.includes('inline-code') && /^`+$/u.test(delimiter)) {
		return { delimiter, kind: 'inline-code' };
	}
	if (tokens.some((token) => token.includes('highlight')) && delimiter === '==') {
		return { delimiter, kind: 'highlight' };
	}
	if (tokens.some((token) => token.includes('strikethrough')) && delimiter === '~~') {
		return { delimiter, kind: 'strikethrough' };
	}
	if (tokens.some((token) => token.includes('strong')) &&
		(delimiter === '**' || delimiter === '__')) {
		return { delimiter, kind: 'strong' };
	}
	if (tokens.some((token) => token.includes('emphasis') || token === 'em') &&
		(delimiter === '*' || delimiter === '_')) {
		return { delimiter, kind: 'emphasis' };
	}
	return null;
}

function hypermdContentMatches(
	node: SyntaxNode,
	kind: Exclude<InlineSemanticConstructKind, 'link'>,
): boolean {
	const tokens = nameTokens(node.name);
	if (kind === 'inline-code') return tokens.includes('inline-code');
	if (kind === 'highlight') return tokens.some((token) => token.includes('highlight'));
	if (kind === 'strikethrough') return tokens.some((token) => token.includes('strikethrough'));
	if (kind === 'strong-emphasis') {
		return tokens.some((token) => token.includes('strong')) &&
			tokens.some((token) => token.includes('emphasis') || token === 'em' ||
				token.endsWith('-em'));
	}
	if (kind === 'strong') return tokens.some((token) => token.includes('strong'));
	return tokens.some((token) => token.includes('emphasis') || token === 'em');
}

function flatHypermdFormattingConstruct(
	state: EditorState,
	node: SyntaxNode,
	knownOpening?: ReturnType<typeof flatHypermdFormattingMarker>,
): InlineSemanticConstruct | null {
	const opening = knownOpening === undefined
		? flatHypermdFormattingMarker(state, node)
		: knownOpening;
	if (!opening) return null;
	const line = state.doc.lineAt(node.from);
	let hasContent = false;
	for (let candidate = node.nextSibling;
		candidate && candidate.to <= line.to;
		candidate = candidate.nextSibling) {
		const closing = flatHypermdFormattingMarker(state, candidate);
		if (closing?.kind === opening.kind && closing.delimiter === opening.delimiter) {
			if (!hasContent || candidate.from <= node.to) return null;
			return {
				editFrom: node.from,
				editTo: candidate.to,
				kind: opening.kind,
				sourceRanges: [delimiterRange(node), delimiterRange(candidate)],
			};
		}
		if (hypermdContentMatches(candidate, opening.kind)) hasContent = true;
	}
	return null;
}

function standardConstruct(
	state: EditorState,
	node: SyntaxNode,
	context: DiscoveryContext,
): InlineSemanticConstruct | null {
	if ((node.name === 'Emphasis' || node.name === 'StrongEmphasis' ||
		node.name === 'InlineCode' || node.name === 'Highlight') &&
		hasUnsupportedLinkAncestor(state, node, context)) return null;
	const combined = combinedStrongEmphasis(node);
	if (combined) return combined;
	if (node.name === 'Emphasis' && !isNestedCombinedComponent(node)) {
		return construct(node, 'emphasis', directMarkRanges(node, 'EmphasisMark'));
	}
	if (node.name === 'StrongEmphasis' && !isNestedCombinedComponent(node)) {
		return construct(node, 'strong', directMarkRanges(node, 'EmphasisMark'));
	}
	if (node.name === 'InlineCode') {
		return construct(node, 'inline-code', directMarkRanges(node, 'CodeMark'));
	}
	if (node.name === 'Highlight') {
		return construct(node, 'highlight', directMarkRanges(node, 'HighlightMark'));
	}
	if (node.name === 'Strikethrough') {
		return construct(node, 'strikethrough', directMarkRanges(node, 'StrikethroughMark'));
	}
	if (node.name === 'Escape') {
		return construct(node, 'escape', [{ from: node.from, to: node.from + 1, kind: 'delimiter' }]);
	}
	return isLinkContainer(node) ? cachedInlineLinkConstruct(state, node, context) : null;
}

function hypermdConstruct(
	state: EditorState,
	node: SyntaxNode,
	knownSource?: string,
): InlineSemanticConstruct | null {
	const tokens = nameTokens(node.name);
	let source = knownSource;
	const nodeSource = (): string => source ??= state.sliceDoc(node.from, node.to);
	if (tokens.some(token => token.includes('strikethrough')) &&
		nodeSource().startsWith('~~') && nodeSource().endsWith('~~') && nodeSource().length > 4 &&
		!/^[~]+$/u.test(nodeSource())) {
		return construct(node, 'strikethrough', edgeRanges(node, 2));
	}
	if (tokens.includes('inline-code')) {
		const opening = /^`+/u.exec(nodeSource())?.[0] ?? '';
		if (opening.length > 0 && nodeSource().endsWith(opening) &&
			node.to - node.from > opening.length * 2) {
			return construct(node, 'inline-code', edgeRanges(node, opening.length));
		}
	}
	if (tokens.some((token) => token.includes('highlight')) &&
		nodeSource().startsWith('==') && nodeSource().endsWith('==') &&
		node.to - node.from > 4) {
		return construct(node, 'highlight', edgeRanges(node, 2));
	}
	if (tokens.some((token) => token.includes('strong')) &&
		tokens.some((token) => token.includes('em'))) {
		const opening = /^(?:\*{3}|_{3})/u.exec(nodeSource())?.[0] ?? '';
		if (opening.length === 3 && nodeSource().endsWith(opening) &&
			node.to - node.from > 6) {
			return construct(node, 'strong-emphasis', edgeRanges(node, 3));
		}
	}
	if (tokens.some((token) => token.includes('strong'))) {
		const opening = /^(?:\*\*|__)/u.exec(nodeSource())?.[0] ?? '';
		if (opening.length === 2 && nodeSource().endsWith(opening) &&
			node.to - node.from > 4) {
			return construct(node, 'strong', edgeRanges(node, 2));
		}
	}
	if (tokens.some((token) => token.includes('emphasis') || token === 'em')) {
		const opening = /^(?:\*|_)/u.exec(nodeSource())?.[0] ?? '';
		if (opening.length === 1 && nodeSource().endsWith(opening) &&
			node.to - node.from > 2) {
			return construct(node, 'emphasis', edgeRanges(node, 1));
		}
	}
	return null;
}

function hypermdWikiConstruct(state: EditorState, node: SyntaxNode): InlineSemanticConstruct | null {
	if (!nameTokens(node.name).includes('formatting-link-start') ||
		state.sliceDoc(node.from, node.to) !== '[[' || hasUnescapedBangBefore(state, node.from)) return null;
	const lineEnd = state.doc.lineAt(node.from).to;
	let contentTo = node.to;
	let aliasFrom: number | null = null;
	for (let candidate = node.nextSibling; candidate && candidate.to <= lineEnd; candidate = candidate.nextSibling) {
		if (candidate.from !== contentTo) return null;
		const tokens = nameTokens(candidate.name);
		if (tokens.includes('formatting-link-end') && state.sliceDoc(candidate.from, candidate.to) === ']]') {
			if (candidate.from <= (aliasFrom ?? node.to)) return null;
			return { editFrom: node.from, editTo: candidate.to, kind: 'wikilink', sourceRanges: [
				delimiterRange(node),
				...(aliasFrom === null ? [] : [{ from: node.to, to: aliasFrom, kind: 'link-destination' as const }]),
				delimiterRange(candidate),
			] };
		}
		if (!tokens.includes('hmd-internal-link')) return null;
		if (tokens.includes('link-alias-pipe')) aliasFrom = candidate.to;
		contentTo = candidate.to;
	}
	return null;
}

function hypermdEscapeConstruct(state: EditorState, node: SyntaxNode): InlineSemanticConstruct | null {
	if (!nameTokens(node.name).includes('hmd-escape-backslash') || state.sliceDoc(node.from, node.to) !== '\\') return null;
	const character = node.nextSibling;
	if (!character || character.from !== node.to || !nameTokens(character.name).includes('hmd-escape-char')) return null;
	return { editFrom: node.from, editTo: character.to, kind: 'escape', sourceRanges: [delimiterRange(node)] };
}

function constructForNode(
	state: EditorState,
	node: SyntaxNode,
	context: DiscoveryContext,
): InlineSemanticConstruct | null {
	const tokens = nameTokens(node.name);
	const couldBeFormatting = node.name === 'Emphasis' || node.name === 'StrongEmphasis' ||
		node.name === 'InlineCode' || node.name === 'Highlight' || node.name === 'Escape' ||
		node.name === 'Strikethrough' || tokens.includes('inline-code') ||
		tokens.some((token) => token.includes('highlight') || token.includes('strong') ||
			token.includes('emphasis') || token.includes('strikethrough') || token.includes('hmd-escape') || token === 'em');
	const couldBeHtml = node.name === 'HTMLTag' || tokens.some(token => token.includes('hmd-html'));
	if ((couldBeFormatting || couldBeHtml || isLinkContainer(node)) && (
		hasUnsupportedLinkAncestor(state, node, context) ||
		context.unsupportedFlatHosts.contains(node.from, node.to)
	)) return null;
	if (node.name === 'Link' && hasStandardBracketOwner(state, node, context)) return null;
	const native = hypermdWikiConstruct(state, node) ?? hypermdEscapeConstruct(state, node);
	if (native) return native;
	const html = inlineHtmlConstruct(state, node);
	if (html) return html;
	const standard = standardConstruct(state, node, context);
	if (standard || node.name === 'Emphasis' || node.name === 'StrongEmphasis' ||
		node.name === 'InlineCode' || node.name === 'Highlight' || node.name === 'Link' ||
		node.name === 'Image' || node.name === 'Autolink' || node.name === 'EmphasisMark' ||
		node.name === 'CodeMark' || node.name === 'HighlightMark' || node.name === 'LinkMark' ||
		node.name === 'URL' || node.name === 'LinkTitle' || node.name === 'LinkLabel') return standard;
	const source = couldBeFormatting ? state.sliceDoc(node.from, node.to) : undefined;
	const marker = couldBeFormatting
		? flatHypermdFormattingMarker(state, node, source)
		: null;
	const flatFormatting = marker
		? flatHypermdFormattingConstruct(state, node, marker)
		: null;
	if (marker) return flatFormatting;
	return hypermdConstruct(state, node, source) ??
		cachedFlatHypermdLinkAnalysis(state, node, context).construct;
}

function foldFlatStrongEmphasis(
	constructs: readonly InlineSemanticConstruct[],
): readonly InlineSemanticConstruct[] {
	const consumed = new Set<InlineSemanticConstruct>();
	const combined: InlineSemanticConstruct[] = [];
	const componentsBySpan = new Map<string, InlineSemanticConstruct>();
	for (const item of constructs) {
		if ((item.kind === 'strong' || item.kind === 'emphasis') && item.sourceRanges.length === 2) {
			componentsBySpan.set(`${item.kind}:${item.editFrom}:${item.editTo}`, item);
		}
	}
	for (const outer of constructs) {
		if ((outer.kind !== 'strong' && outer.kind !== 'emphasis') ||
			outer.sourceRanges.length !== 2) {
			continue;
		}
		const innerKind = outer.kind === 'strong' ? 'emphasis' : 'strong';
		const innerFrom = outer.sourceRanges[0]!.to;
		const innerTo = outer.sourceRanges[1]!.from;
		const inner = componentsBySpan.get(`${innerKind}:${innerFrom}:${innerTo}`);
		if (!inner || inner.sourceRanges[0]!.from !== inner.editFrom ||
			inner.sourceRanges[1]!.to !== inner.editTo) continue;
		consumed.add(outer);
		consumed.add(inner);
		combined.push({
			editFrom: outer.editFrom,
			editTo: outer.editTo,
			kind: 'strong-emphasis',
			sourceRanges: mergeAdjacentDelimiterRanges([
				...outer.sourceRanges,
				...inner.sourceRanges,
			]),
		});
	}
	return [...constructs.filter((item) => !consumed.has(item)), ...combined];
}

function sameSyntaxNode(left: SyntaxNode, right: SyntaxNode): boolean {
	return left.from === right.from && left.to === right.to && left.type === right.type;
}

function commonSelectionAncestor(
	tree: Tree,
	from: number,
	to: number,
): SyntaxNode {
	const start = tree.resolveInner(from, 1);
	const endAncestors: SyntaxNode[] = [];
	for (let node: SyntaxNode | null = tree.resolveInner(to, -1); node; node = node.parent) {
		endAncestors.push(node);
	}
	for (let node: SyntaxNode | null = start; node; node = node.parent) {
		if (endAncestors.some((candidate) => sameSyntaxNode(node, candidate))) return node;
	}
	return tree.topNode;
}

function visitSyntaxNodes(
	tree: Tree,
	span: SourceSpan,
	visit: (node: SyntaxNode) => void,
): void {
	const root = commonSelectionAncestor(tree, span.from, span.to);
	for (let ancestor = root.parent; ancestor; ancestor = ancestor.parent) visit(ancestor);
	const visitIntersecting = (node: SyntaxNode): void => {
		visit(node);
		for (let child = node.childAfter(span.from);
			child && child.from < span.to;
			child = child.nextSibling) {
			if (span.from < child.to) visitIntersecting(child);
		}
	};
	visitIntersecting(root);
}

function discoverySpans(
	state: EditorState,
	requiredRanges: readonly SelectionRange[],
): readonly SourceSpan[] {
	return requiredRanges.flatMap((range) => {
		const firstLine = state.doc.lineAt(range.from);
		const lastLine = state.doc.lineAt(range.empty ? range.head : range.to - 1);
		return firstLine.from < lastLine.to
			? [{ from: firstLine.from, to: lastLine.to }]
			: [];
	});
}

function relevantToRange(
	state: EditorState,
	item: InlineSemanticConstruct,
	range: SelectionRange,
): boolean {
	if (!range.empty) return intersectsSelection(item, range);
	const line = state.doc.lineAt(range.head);
	return line.from <= item.editFrom && item.editTo <= line.to;
}

const semanticConstructs = new WeakMap<Text, {
	tree: Tree; pending: readonly PendingMathRange[]; constructs: readonly InlineSemanticConstruct[];
}>();

export function discoverInlineSemanticConstructs(
	state: EditorState,
	requiredRanges?: readonly SelectionRange[],
): readonly InlineSemanticConstruct[] {
	if (requiredRanges?.length === 0) return [];
	const spans = requiredRanges ? discoverySpans(state, requiredRanges) : null;
	if (spans?.length === 0) return [];
	const requiredTo = spans
		? Math.max(...spans.map((span) => span.to))
		: state.doc.length;
	if (!syntaxTreeAvailable(state, requiredTo)) return [];
	const tree = syntaxTree(state), pending = pendingMathRanges(state), cached = semanticConstructs.get(state.doc);
	// Selection, focus and preview-height changes share immutable syntax. Only a
	// complete discovery can serve other consumers; partial parse results stay local.
	if (cached?.tree === tree && cached.pending === pending) return requiredRanges
		? cached.constructs.filter(item => requiredRanges.some(range => relevantToRange(state, item, range))) : cached.constructs;
	const found = new Map<string, InlineSemanticConstruct>();
	const context: DiscoveryContext = {
		flatLinks: new Map(),
		indexedFlatLinkLines: new Set(),
		inlineLinks: new Map(),
		standardBracketOwners: new Map(),
		unsupportedFlatHosts: new SourceSpanIndex(),
	};
	const addNode = (node: SyntaxNode): void => {
		const item = constructForNode(state, node, context);
		if (!item || item.editFrom >= item.editTo) return;
		found.set(`${item.editFrom}:${item.editTo}:${item.kind}`, item);
	};
	const addHostNode = (node: SyntaxNode): void => {
		if (!pendingMathAt(state, node.from, node.to)) addNode(node);
	};
	if (spans) {
		for (const span of spans) visitSyntaxNodes(tree, span, addHostNode);
	} else {
		tree.iterate({ enter: (ref) => addHostNode(ref.node) });
	}
	// HyperMD tokenizes the entire unfinished suffix as math; ordinary ownership is local to pending ranges.
	for (const pending of pendingMathRanges(state)) {
		if (spans && !spans.some(span => span.from <= pending.to && pending.from <= span.to)) continue;
		contentSyntaxTree(state).iterate({ from: pending.from, to: pending.to, enter(ref) {
			if (pendingMathAt(state, ref.from, ref.to)) addNode(ref.node);
		} });
	}
	const constructs = [...foldFlatStrongEmphasis([...found.values()])].sort((left, right) =>
		left.editFrom - right.editFrom || right.editTo - left.editTo ||
		left.kind.localeCompare(right.kind));
	if (!requiredRanges) semanticConstructs.set(state.doc, { tree, pending, constructs });
	return constructs.filter((item) => (!requiredRanges ||
		requiredRanges.some((range) => relevantToRange(state, item, range))));
}

function intersectsSelection(
	item: InlineSemanticConstruct,
	selection: SelectionRange,
): boolean {
	return selection.from < item.editTo && item.editFrom < selection.to;
}

export function discoverInlineSelectionSourceRanges(
	state: EditorState,
	requiredRanges?: readonly SelectionRange[],
): readonly InlineSelectionSourceRange[] {
	const selections = requiredRanges?.filter((range) => !range.empty);
	if (selections?.length === 0) return [];
	const constructs = discoverInlineSemanticConstructs(state, selections);
	const ranges = constructs
		.filter((item) => !selections || selections.some((selection) =>
			intersectsSelection(item, selection)))
		.flatMap((item) => item.sourceRanges);
	return mergeSourceRanges(ranges);
}

function touchingConstruct(
	constructs: readonly InlineSemanticConstruct[],
	position: number,
): InlineSemanticConstruct | null {
	return constructs
		.filter((item) => item.editFrom <= position && position <= item.editTo)
		.sort((left, right) =>
			(left.editTo - left.editFrom) - (right.editTo - right.editFrom) ||
			right.editFrom - left.editFrom || left.kind.localeCompare(right.kind))[0] ?? null;
}

export function inlineSemanticConstructAt(
	state: EditorState,
	position: number,
	kind?: InlineSemanticConstructKind,
): InlineSemanticConstruct | null {
	const clamped = Math.max(0, Math.min(position, state.doc.length));
	const constructs = discoverInlineSemanticConstructs(state, [EditorSelection.cursor(clamped)]);
	return touchingConstruct(
		kind === undefined ? constructs : constructs.filter((item) => item.kind === kind),
		clamped,
	);
}

function bodyRanges(item: InlineSemanticConstruct): readonly SourceSpan[] {
	let from = item.editFrom;
	const bodies: SourceSpan[] = [];
	for (const range of [...item.sourceRanges].sort((left, right) => left.from - right.from || left.to - right.to)) {
		const to = Math.max(from, Math.min(range.from, item.editTo));
		if (from < to) bodies.push({ from, to });
		from = Math.max(from, Math.min(range.to, item.editTo));
	}
	if (from < item.editTo) bodies.push({ from, to: item.editTo });
	return bodies;
}

function mapConstruct(item: InlineSemanticConstruct, changes: ChangeDesc): InlineSemanticConstruct {
	return { ...item, editFrom: changes.mapPos(item.editFrom, 1), editTo: changes.mapPos(item.editTo, -1) };
}

function bodyDecorations(item: InlineSemanticConstruct): ReturnType<Decoration['range']>[] {
	if (item.htmlBodies) return item.htmlBodies.filter(range => range.from < range.to).map(range =>
		Decoration.mark({ tagName: range.tagName,
			class: `${INLINE_BODY_CLASS} ${INLINE_BODY_CLASS}--inline-html`,
		}).range(range.from, range.to));
	return bodyRanges(item).map(({ from, to }) => Decoration.mark({
			class: `${INLINE_BODY_CLASS} ${INLINE_BODY_CLASS}--${item.kind}`,
		}).range(from, to));
}

function hasLineLocalSourceRanges(state: EditorState, item: InlineSemanticConstruct): boolean {
	return item.sourceRanges.every(({ from, to }) =>
		state.doc.lineAt(from).number === state.doc.lineAt(to).number);
}

function projectionDecorations(
	state: EditorState,
	visibleRanges: readonly { readonly from: number; readonly to: number }[],
	previousActive: readonly InlineSemanticConstruct[],
	frozenActive: readonly InlineSemanticConstruct[] | undefined,
	isOwnerActive: () => boolean,
	renderInlineHtml?: InlineHtmlRenderer,
): { readonly decorations: DecorationSet; readonly nativeOwners: DecorationSet; readonly active: readonly InlineSemanticConstruct[] } {
	const visibleSelections = visibleRanges.map(({ from, to }) => EditorSelection.range(from, to));
	const strikeCorrections = malformedNativeStrikeRanges(state, visibleRanges);
	const discovered = discoverInlineSemanticConstructs(state, visibleSelections)
		.filter((item) => hasLineLocalSourceRanges(state, item) && (item.kind !== 'inline-html' || renderInlineHtml) &&
			(item.kind !== 'strikethrough' || !ownsTildeRun(state, item.editFrom, item.editTo)));
	for (const range of strikeCorrections) if (range.literal && !ownsTildeRun(state, range.from, range.to)) discovered.push({
		editFrom: range.from, editTo: range.to, kind: 'literal-strike', sourceRanges: [],
	});
	const htmlConstructs = discovered.filter(item => item.kind === 'inline-html');
	const constructs = discovered.filter(item => !htmlConstructs.some(html => html !== item &&
		html.editFrom <= item.editFrom && item.editTo <= html.editTo));
	const mode = classifyCurrentSelectionMode(state);
	const matchingConstruct = (item: InlineSemanticConstruct | null) => item
		? constructs.find((candidate) => candidate.editFrom === item.editFrom &&
			candidate.editTo === item.editTo && candidate.kind === item.kind) ?? null
		: null;
	const caret = state.selection.main;
	// Native DOM reconciliation may adjust a caret within the source just revealed.
	const synchronizedActive = (mode === 'unknown' || mode === 'caret') && state.selection.ranges.length === 1 && caret.empty
		? previousActive.filter(item => item.editFrom <= caret.head && caret.head <= item.editTo) : [];
	const endpoints = inlineEndpointOwners(state, constructs.filter(item => item.kind !== 'literal-strike' || caret.empty).map(item => ({
		from: item.editFrom, to: item.editTo, bodies: bodyRanges(item), item,
	}))).map(owner => owner.item);
	const active = frozenActive !== undefined ? frozenActive.map(matchingConstruct).filter((item): item is InlineSemanticConstruct => item !== null)
		: endpoints.length > 0 ? endpoints : synchronizedActive.map(matchingConstruct).filter((item): item is InlineSemanticConstruct => item !== null);
	const nativeOwners: ReturnType<Decoration['range']>[] = [];
	const ranges = constructs.flatMap((item) => {
		const revealed = active.includes(item);
		nativeOwners.push(Decoration.mark({ class: `paraflow-inline-owner--${item.kind}` }).range(item.editFrom, item.editTo));
		if (item.kind === 'literal-strike' && !revealed) {
			return [Decoration.replace({ widget: new LiteralStrikeWidget(item.editFrom,
				state.sliceDoc(item.editFrom, item.editTo), isOwnerActive) }).range(item.editFrom, item.editTo)];
		}
		if (item.kind === 'inline-html' && !revealed) {
			return [Decoration.replace({ widget: new InlineHtmlWidget(
				state.sliceDoc(item.editFrom, item.editTo), renderInlineHtml!, item.editFrom, isOwnerActive,
			) }).range(item.editFrom, item.editTo)];
		}
		const source = item.sourceRanges.map((range) =>
			(revealed
				? Decoration.mark({ class: ACTIVE_INLINE_SOURCE_CLASS + (item.kind === 'strikethrough' ? ' paraflow-inline-source-active--strikethrough' : '') })
				: Decoration.replace({}))
				.range(range.from, range.to));
		if (revealed) nativeOwners.push(...source);
		return [...(revealed ? [] : source), ...bodyDecorations(item)];
	});
	for (const range of strikeCorrections) {
		nativeOwners.push(Decoration.mark({ class: 'paraflow-invalid-native-strike' }).range(range.from, range.to));
	}
	for (const range of literalFormattingMarkers(state, visibleRanges)) {
		nativeOwners.push(Decoration.mark({ class: 'paraflow-literal-inline-marker' }).range(range.from, range.to));
	}
	for (const range of unresolvedShortcutReferences(state, visibleRanges)) {
		nativeOwners.push(Decoration.mark({ class: 'paraflow-literal-reference' }).range(range.from, range.to));
	}
	return { active, decorations: Decoration.set(ranges, true), nativeOwners: Decoration.set(nativeOwners, true) };
}

function unpairedCodeBody(state: EditorState, marker: SyntaxNode, constructs: readonly InlineSemanticConstruct[]) {
	const body = marker.nextSibling;
	if (!nameTokens(marker.name).includes('inline-code') || !body || body.from !== marker.to ||
		!nameTokens(body.name).includes('inline-code') ||
		state.doc.lineAt(marker.from).to < body.to ||
		constructs.some(item => item.kind === 'inline-code' && item.editFrom < body.to && body.from < item.editTo)) return null;
	return { from: body.from, to: body.to };
}

interface LiteralMarkerSnapshot {
	readonly tree: Tree;
	readonly pending: readonly PendingMathRange[];
	readonly subscript: boolean;
	readonly queries: {
		readonly spans: readonly SourceSpan[];
		readonly pendingContent: Tree | null;
		readonly literals: readonly SourceSpan[];
	}[];
}
const literalMarkerSnapshots = new WeakMap<Text, LiteralMarkerSnapshot>();

export function literalFormattingMarkers(
	state: EditorState,
	visibleRanges: readonly SourceSpan[],
): readonly SourceSpan[] {
	const ranges = visibleRanges.map(range => EditorSelection.range(
		state.doc.lineAt(range.from).from, state.doc.lineAt(range.to).to));
	// Coverage can advance independently of projected semantic-tree identity.
	if (ranges.some(range => !syntaxTreeAvailable(state, range.to))) return [];
	const tree = syntaxTree(state), pending = pendingMathRanges(state);
	const pendingContent = pending.length > 0 && discoverySpans(state, ranges).some(span =>
		pending.some(item => span.from <= item.to && item.from <= span.to)) ? contentSyntaxTree(state) : null;
	const subscript = Boolean(state.facet(shorthandSettings)?.().subscript);
	let snapshot = literalMarkerSnapshots.get(state.doc);
	if (!snapshot || snapshot.tree !== tree || snapshot.pending !== pending || snapshot.subscript !== subscript) {
		snapshot = { tree, pending, subscript, queries: [] };
		literalMarkerSnapshots.set(state.doc, snapshot);
	}
	const cached = snapshot.queries.find(query => query.pendingContent === pendingContent && query.spans.length === ranges.length &&
		query.spans.every((span, index) => span.from === ranges[index]!.from && span.to === ranges[index]!.to));
	if (cached) return cached.literals;
	const constructs = discoverInlineSemanticConstructs(state, ranges);
	const literals: { from: number; to: number }[] = [];
	for (const range of ranges) tree.iterate({ from: range.from, to: range.to, enter(ref) {
		const tokens = nameTokens(ref.name);
		if (!tokens.some(token => token === 'formatting' || token.startsWith('formatting-')) ||
			!flatHypermdFormattingMarker(state, ref.node) || ownsTildeRun(state, ref.from, ref.to)) return;
		if (!constructs.some(item => item.sourceRanges.some(source => source.kind === 'delimiter' &&
			source.from <= ref.from && ref.to <= source.to))) {
			literals.push({ from: ref.from, to: ref.to });
			const body = unpairedCodeBody(state, ref.node, constructs);
			if (body) literals.push(body);
		}
	} });
	// Decoration and native-ownership consumers interleave viewport and local queries.
	// Retain only a few spans so scrolling cannot retain every visited viewport.
	if (snapshot.queries.length === 4) snapshot.queries.shift();
	snapshot.queries.push({ spans: ranges, pendingContent, literals });
	return literals;
}

export function createInlineSelectionProjection(
	isStateActive: (state: EditorState) => boolean,
	isViewActive: (view: EditorView) => boolean = () => true,
	renderInlineHtml?: InlineHtmlRenderer,
): Extension {
	const literalMarkerOwner = (state: EditorState, view: EditorView) => {
		if (!isStateActive(state) || !isViewActive(view)) return null;
		const literals = literalFormattingMarkers(state, view.visibleRanges);
		return (from: number, to: number, decoration: Decoration) => isNativeReplacement(decoration) &&
			literals.some(item => item.from <= from && to <= item.to);
	};
	const htmlOwner = (state: EditorState, view: EditorView) => {
		if (!renderInlineHtml || !isStateActive(state) || !isViewActive(view)) return null;
		const html = discoverInlineSemanticConstructs(state).filter(item => item.kind === 'inline-html' && hasLineLocalSourceRanges(state, item));
		return (from: number, to: number, decoration: Decoration) => isNativeReplacement(decoration) &&
			html.some(item => item.editFrom <= from && to <= item.editTo);
	};
	return [createInlineRevealPointerExtension(), createRenderedSourceClickExtension(), createNativeDecorationOwnership(),
		nativeBlockOwnership.of(htmlOwner), nativeInlineOwnership.of(htmlOwner), nativeInlineOwnership.of(literalMarkerOwner), Prec.highest(ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		nativeOwners: DecorationSet = Decoration.none;
		private active: boolean;
		private activeConstructs: readonly InlineSemanticConstruct[] = [];
		private frozenConstructs: readonly InlineSemanticConstruct[] = [];
		private pointerPressed: boolean;
		private destroyed = false;
		private readonly isOwnerActive = (): boolean => !this.destroyed && this.isActive();

		constructor(private readonly view: EditorView) {
			this.active = this.isActive();
			this.pointerPressed = inlineRevealPointerHeld(view.state);
			this.decorations = this.build(this.active);
		}

		update(update: ViewUpdate): void {
			const active = this.isActive();
			const pointerPressed = inlineRevealPointerHeld(update.state);
			const reconfigured = update.transactions.some((transaction) => transaction.reconfigured);
			if (!update.docChanged && !update.selectionSet && !update.viewportChanged && !reconfigured &&
				active === this.active &&
				pointerPressed === this.pointerPressed &&
				pendingMathRanges(update.startState) === pendingMathRanges(update.state) &&
				syntaxTree(update.startState) === syntaxTree(update.state)) return;
			if (update.docChanged) {
				this.activeConstructs = this.activeConstructs.map(item => mapConstruct(item, update.changes));
				this.frozenConstructs = this.frozenConstructs.map(item => mapConstruct(item, update.changes));
			} else if (pointerPressed && !this.pointerPressed) {
				// Keep the geometry used by the native mouse-selection anchor until release.
				this.frozenConstructs = this.activeConstructs;
			}
			this.pointerPressed = pointerPressed;
			this.active = active;
			this.decorations = this.build(active);
		}

		private isActive(): boolean {
			return isStateActive(this.view.state) && isViewActive(this.view);
		}

		destroy(): void { this.destroyed = true; }

		private build(active: boolean): DecorationSet {
			if (!active) {
				this.nativeOwners = Decoration.none;
				this.activeConstructs = [];
				this.frozenConstructs = [];
				return Decoration.none;
			}
			const projection = projectionDecorations(
				this.view.state,
				this.view.visibleRanges,
				this.activeConstructs,
				this.pointerPressed ? this.frozenConstructs : undefined,
				this.isOwnerActive,
				renderInlineHtml,
			);
			this.activeConstructs = projection.active;
			this.nativeOwners = projection.nativeOwners;
			return projection.decorations;
		}
	}, {
		decorations: (value) => value.decorations,
		provide: plugin => EditorView.outerDecorations.of(view => view.plugin(plugin)!.nativeOwners),
	}))];
}
