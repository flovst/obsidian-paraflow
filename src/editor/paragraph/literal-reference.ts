import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';
import { metadataGrammar, nativeInlineGrammarFor } from '../markdown-grammar.js';
import { mathRangeIndex } from '../math/syntax.js';

const normalizedLabel = (label: string): string => label.trim().replace(/\s+/gu, ' ').toUpperCase();
const tokens = (node: SyntaxNode): string[] => node.name.split('_');

export interface ResolvedReferenceLink {
	readonly from: number;
	readonly to: number;
	readonly destination: string;
}

const referenceParser = parser.configure([GFM, metadataGrammar]);
const indexes = new WeakMap<Text, { definitions: ReadonlyMap<string, string>; links: readonly ResolvedReferenceLink[] }>();

/** HyperMD exposes reference paint tokens but no resolved destination. */
function referenceIndex(state: EditorState) {
	const cached = indexes.get(state.doc);
	if (cached) return cached;
	const tree = referenceParser.configure(nativeInlineGrammarFor(mathRangeIndex(state).expressions)).parse(state.doc.toString());
	const definitions = new Map<string, string>();
	tree.iterate({ enter(ref) {
		if (ref.name !== 'LinkReference') return;
		const labelNode = ref.node.getChild('LinkLabel')!;
		const url = ref.node.getChild('URL')!;
		const label = normalizedLabel(state.sliceDoc(labelNode.from + 1, labelNode.to - 1));
		if (label.startsWith('^') || definitions.has(label)) return;
		const raw = state.sliceDoc(url.from, url.to);
		definitions.set(label, raw.startsWith('<') ? raw.slice(1, -1) : raw);
	} });
	const links: ResolvedReferenceLink[] = [];
	tree.iterate({ enter(ref) {
		if (ref.name === 'Image') return false;
		if (ref.name !== 'Link' || ref.node.getChild('URL')) return;
		const marks = ref.node.getChildren('LinkMark');
		const before = state.sliceDoc(Math.max(0, ref.from - 1), ref.from);
		if (marks.length !== 2 || state.sliceDoc(ref.from, ref.from + 2) === '[[' ||
			before === '^' || (before === '[' && state.sliceDoc(ref.to, ref.to + 1) === ']')) return false;
		const explicit = ref.node.getChild('LinkLabel');
		const label = normalizedLabel(explicit && explicit.to - explicit.from > 2
			? state.sliceDoc(explicit.from + 1, explicit.to - 1)
			: state.sliceDoc(marks[0]!.to, marks[1]!.from));
		const destination = definitions.get(label);
		if (destination !== undefined) links.push({ from: ref.from, to: ref.to, destination });
		return false;
	} });
	const index = { definitions, links };
	indexes.set(state.doc, index);
	return index;
}

export function resolvedReferenceLinkAt(state: EditorState, position: number): ResolvedReferenceLink | null {
	return referenceIndex(state).links.find(link => link.from <= position && position < link.to) ?? null;
}

function shortcutRange(state: EditorState, opening: SyntaxNode) {
	const names = tokens(opening);
	if (!names.includes('hmd-barelink') || !names.includes('formatting-link') ||
		names.includes('footref') || names.includes('hmd-footnote') ||
		state.sliceDoc(opening.from, opening.to) !== '[') return null;
	const body = opening.nextSibling;
	const closing = body?.nextSibling;
	if (!body || !closing || body.from !== opening.to || closing.from !== body.to ||
		!tokens(body).includes('hmd-barelink') || state.sliceDoc(closing.from, closing.to) !== ']' ||
		state.doc.lineAt(opening.from).to < closing.to) return null;
	const suffix = state.sliceDoc(closing.to, closing.to + 1);
	if (suffix === '[' || suffix === '(' || state.sliceDoc(opening.from - 1, opening.from) === '!') return null;
	return { from: opening.from, to: closing.to, label: normalizedLabel(state.sliceDoc(body.from, body.to)) };
}

/** Definitions can occur after the viewport; absence requires a complete document tree. */
export function unresolvedShortcutReferences(state: EditorState, ranges: readonly { from: number; to: number }[]) {
	if (!syntaxTreeAvailable(state, state.doc.length)) return [];
	const { definitions } = referenceIndex(state);
	const literals: { from: number; to: number }[] = [];
	for (const range of ranges) syntaxTree(state).iterate({ from: range.from, to: range.to, enter(ref) {
		const shortcut = shortcutRange(state, ref.node);
		if (shortcut && !definitions.has(shortcut.label)) literals.push({ from: shortcut.from, to: shortcut.to });
	} });
	return literals;
}
