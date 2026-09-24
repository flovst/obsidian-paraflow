import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import {
	EditorSelection,
	Prec,
	type EditorState,
	type Extension,
	type SelectionRange,
} from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { classifyCurrentSelectionMode } from '../runtime/input-state.js';
import { selectionProjectionCoverage } from '../runtime/selection-session.js';

export const ACTIVE_INLINE_SOURCE_CLASS = 'paraflow-inline-source-active';
export const INLINE_BODY_CLASS = 'paraflow-inline-body';

export type InlineSelectionSourceKind = 'delimiter' | 'link-destination';

export type InlineSemanticConstructKind =
	| 'emphasis'
	| 'strong'
	| 'strong-emphasis'
	| 'highlight'
	| 'inline-code'
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
			token.includes('emphasis') || token === 'em')) return null;
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

function constructForNode(
	state: EditorState,
	node: SyntaxNode,
	context: DiscoveryContext,
): InlineSemanticConstruct | null {
	const tokens = nameTokens(node.name);
	const couldBeFormatting = node.name === 'Emphasis' || node.name === 'StrongEmphasis' ||
		node.name === 'InlineCode' || node.name === 'Highlight' || tokens.includes('inline-code') ||
		tokens.some((token) => token.includes('highlight') || token.includes('strong') ||
			token.includes('emphasis') || token === 'em');
	if ((couldBeFormatting || isLinkContainer(node)) && (
		hasUnsupportedLinkAncestor(state, node, context) ||
		context.unsupportedFlatHosts.contains(node.from, node.to)
	)) return null;
	if (node.name === 'Link' && hasStandardBracketOwner(state, node, context)) return null;
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
	const tree = syntaxTree(state);
	if (spans) {
		for (const span of spans) visitSyntaxNodes(tree, span, addNode);
	} else {
		tree.iterate({ enter: (ref) => addNode(ref.node) });
	}
	const constructs = [...foldFlatStrongEmphasis([...found.values()])].sort((left, right) =>
		left.editFrom - right.editFrom || right.editTo - left.editTo ||
		left.kind.localeCompare(right.kind));
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

function bodyDecorations(item: InlineSemanticConstruct): ReturnType<Decoration['range']>[] {
	let from = item.editFrom;
	const body: ReturnType<Decoration['range']>[] = [];
	for (const range of [...item.sourceRanges].sort((left, right) =>
		left.from - right.from || left.to - right.to)) {
		const to = Math.max(from, Math.min(range.from, item.editTo));
		if (from < to) {
			body.push(Decoration.mark({
				class: `${INLINE_BODY_CLASS} ${INLINE_BODY_CLASS}--${item.kind}`,
			}).range(from, to));
		}
		from = Math.max(from, Math.min(range.to, item.editTo));
	}
	if (from < item.editTo) {
		body.push(Decoration.mark({
			class: `${INLINE_BODY_CLASS} ${INLINE_BODY_CLASS}--${item.kind}`,
		}).range(from, item.editTo));
	}
	return body;
}

function projectionDecorations(
	state: EditorState,
	visibleRanges: readonly { readonly from: number; readonly to: number }[],
	coverage: EditorSelection | null,
): DecorationSet {
	const visibleSelections = visibleRanges.map(({ from, to }) => EditorSelection.range(from, to));
	const constructs = discoverInlineSemanticConstructs(state, visibleSelections);
	const hasSelection = coverage?.ranges.some((range) => !range.empty) ?? false;
	const caret = !hasSelection && classifyCurrentSelectionMode(state) === 'caret'
		? state.selection.main
		: null;
	const active = caret ? touchingConstruct(constructs, caret.head) : null;
	const ranges = constructs.flatMap((item) => {
		const source = item.sourceRanges.map((range) =>
			(item === active
				? Decoration.mark({ class: ACTIVE_INLINE_SOURCE_CLASS })
				: Decoration.replace({}))
				.range(range.from, range.to));
		return [...source, ...bodyDecorations(item)];
	});
	return Decoration.set(ranges, true);
}

export function createInlineSelectionProjection(
	isStateActive: (state: EditorState) => boolean,
	isViewActive: (view: EditorView) => boolean = () => true,
): Extension {
	return Prec.highest(ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		private active: boolean;

		constructor(private readonly view: EditorView) {
			this.active = this.isActive();
			this.decorations = this.build(this.active);
		}

		update(update: ViewUpdate): void {
			const active = this.isActive();
			if (!update.docChanged && !update.selectionSet && !update.viewportChanged &&
				active === this.active &&
				syntaxTree(update.startState) === syntaxTree(update.state) &&
				selectionProjectionCoverage(update.startState) ===
					selectionProjectionCoverage(update.state)) return;
			this.active = active;
			this.decorations = this.build(active);
		}

		private isActive(): boolean {
			return isStateActive(this.view.state) && isViewActive(this.view);
		}

		private build(active: boolean): DecorationSet {
			if (!active) return Decoration.none;
			return projectionDecorations(
				this.view.state,
				this.view.visibleRanges,
				selectionProjectionCoverage(this.view.state),
			);
		}
	}, {
		decorations: (value) => value.decorations,
	}));
}
