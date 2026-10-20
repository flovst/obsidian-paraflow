import { language, syntaxTree } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';
import type { Decoration } from '@codemirror/view';
import { contentSyntaxTree } from '../callout/projection.js';
import { codeDraft } from '../code-blocks/draft-state.js';
import { discoverCodeBlocks } from '../code-blocks/model.js';
import { isNativeReplacement } from '../runtime/native-decoration-ownership.js';
import { pendingMathRanges } from './candidate-ranges.js';
import { acceptedMath, discoverMath, isLiteralDollarRun, type MathExpression } from './syntax.js';
import { createRangeQuery } from './range-query.js';

type Range = { from: number; to: number };
type NativeFilter = (from: number, to: number, decoration: Decoration) => boolean;
interface Analysis {
	readonly drafts: readonly Range[];
	readonly filter: NativeFilter;
}

function dependencies(state: EditorState) {
	return { tree: syntaxTree(state), language: state.facet(language), pending: pendingMathRanges(state),
		accepted: state.facet(acceptedMath), codeDraft: state.facet(codeDraft) };
}

const analyses = new WeakMap<Text, ReturnType<typeof dependencies> & { analysis: Analysis }>();

function mathDraftContext(state: EditorState, from: number, to: number): boolean {
	let opaque = false;
	for (const tree of [syntaxTree(state), contentSyntaxTree(state)]) tree.iterate({ from, to, enter(node) {
		if (node.from >= to || node.to <= from) return;
		if (/(?:InlineCode|FencedCode|CodeBlock|HTMLBlock|HTMLTag|CalloutNativeMetadata|(?:^|[ _-])(?:comment|frontmatter|yaml)(?:$|[ _-]))/iu.test(node.name) ||
			/CalloutNative/u.test(node.name) && state.sliceDoc(node.from, node.from + 2) === '%%') opaque = true;
	} });
	return !opaque;
}

function discoverDrafts(state: EditorState, expressions: readonly MathExpression[]): readonly Range[] {
	const drafts: Range[] = [];
	const owned = createRangeQuery(expressions);
	let code: ReturnType<typeof createRangeQuery> | undefined;
	for (let number = 1; number <= state.doc.lines; number += 1) {
		const line = state.doc.line(number), prefix = /^[ \t]*(?:>[ \t]*)*/u.exec(line.text)![0];
		const from = line.from + prefix.length;
		if (!isLiteralDollarRun(line.text.slice(prefix.length)) || owned.overlapsClosed(line.from, line.to) || !mathDraftContext(state, from, line.to) ||
			(code ??= createRangeQuery(discoverCodeBlocks(state))).overlapsClosed(line.from, line.to)) continue;
		drafts.push({ from, to: line.to });
	}
	return drafts;
}

function analysisFor(state: EditorState): Analysis {
	const current = dependencies(state), cached = analyses.get(state.doc);
	if (cached?.tree === current.tree && cached.language === current.language && cached.pending === current.pending &&
		cached.accepted === current.accepted && cached.codeDraft === current.codeDraft) return cached.analysis;
	const expressions = discoverMath(state), drafts = discoverDrafts(state, expressions);
	const owners = [...expressions.filter(math => math.display || math.contentFrom - math.from === 2), ...drafts, ...current.pending];
	const owned = createRangeQuery(owners);
	const filter: NativeFilter = (from, to, decoration) => {
		const spec = decoration.spec as { block?: boolean; widget?: { math?: unknown; block?: boolean } };
		const displayWidget = spec.widget?.block === true && typeof spec.widget.math === 'string';
		if (!spec.block && !displayWidget) return false;
		return isNativeReplacement(decoration) && from < to && owned.containsPoint(from) ||
			!!spec.widget && from === to && owned.containsEndPoint(from);
	};
	const analysis = { drafts, filter };
	analyses.set(state.doc, { ...current, analysis });
	return analysis;
}

/** Parsing/candidate dependencies own this analysis; cursor and measurement updates do not. */
export function mathDraftRanges(state: EditorState): readonly Range[] { return analysisFor(state).drafts; }
export function mathNativeOwnership(state: EditorState): NativeFilter { return analysisFor(state).filter; }
