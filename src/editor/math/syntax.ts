import { Facet, type EditorState, type Text } from '@codemirror/state';
import { pendingMathRanges } from './candidate-ranges.js';
import { scanMathRanges, type MathExpression, type MathRangeIndex } from './range-scanner.js';
import { codeDraft } from '../code-blocks/draft-state.js';
import { codeDraftMask, maskCodeSource } from '../code-blocks/parser-source.js';
import { createRangeQuery } from './range-query.js';
export type { MathExpression } from './range-scanner.js';

const indices = new WeakMap<Text, { from: number | undefined; to: number | undefined; index: MathRangeIndex }>();
const discoveries = new WeakMap<EditorState, readonly MathExpression[]>();
export const acceptedMath = Facet.define<readonly MathExpression[], readonly MathExpression[]>({ combine: values => values[0] ?? [] });
export function mathRangeIndex(state: EditorState): MathRangeIndex {
	const draft = state.facet(codeDraft), cached = indices.get(state.doc);
	if (cached && cached.from === draft?.from && cached.to === draft?.to) return cached.index;
	const source = state.sliceDoc();
	const index = scanMathRanges(maskCodeSource(source, codeDraftMask(source, draft)));
	indices.set(state.doc, { from: draft?.from, to: draft?.to, index });
	return index;
}
export function isLiteralDollarRun(source: string): boolean { return /^\$+$/u.test(source); }
export function discoverMath(state: EditorState): readonly MathExpression[] {
	const cached = discoveries.get(state);
	if (cached) return cached;
	const accepted = state.facet(acceptedMath);
	const owners = createRangeQuery(accepted), pending = createRangeQuery(pendingMathRanges(state));
	const expressions = [...accepted, ...discoverParsedMath(state).filter(math =>
		(!math.display || !pending.contains(math.from, math.to)) && !owners.overlaps(math.from, math.to))].sort((a, b) => a.from - b.from);
	discoveries.set(state, expressions);
	return expressions;
}
export function discoverParsedMath(state: EditorState) { return mathRangeIndex(state).expressions; }
