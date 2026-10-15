import { Facet, type EditorState, type Text } from '@codemirror/state';
import { pendingMathAt } from './candidate-ranges.js';
import { scanMathRanges, type MathExpression, type MathRangeIndex } from './range-scanner.js';
import { codeDraft } from '../code-blocks/draft-state.js';
import { codeDraftMask, maskCodeSource } from '../code-blocks/parser-source.js';
export type { MathExpression } from './range-scanner.js';

const indices = new WeakMap<Text, { from: number | undefined; to: number | undefined; index: MathRangeIndex }>();
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
export function discoverMath(state: EditorState) {
	const accepted = state.facet(acceptedMath);
	return [...accepted, ...discoverParsedMath(state).filter(math =>
		(!math.display || !pendingMathAt(state, math.from, math.to)) && !accepted.some(old => old.from < math.to && math.from < old.to))].sort((a, b) => a.from - b.from);
}
export function discoverParsedMath(state: EditorState) { return mathRangeIndex(state).expressions; }
