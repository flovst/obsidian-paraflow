import type { EditorState } from '@codemirror/state';
import { quoteContainers } from '../callout/presentation-model.js';
import { projectQuoteContent } from '../callout/projection.js';
import type { MathExpression } from './syntax.js';
import { blockContinuationPrefix, blockLineContentFrom } from '../runtime/block-body.js';
import { mathQuotePrefix } from './quote-prefix.js';

export interface MathSourceLine {
	readonly number: number;
	readonly prefixFrom: number;
	readonly prefixTo: number;
	readonly from: number;
	readonly to: number;
	readonly text: string;
}

export interface MathSource {
	readonly source: string;
	readonly lines: readonly MathSourceLine[];
	readonly bodyLines: readonly MathSourceLine[];
	readonly from: number;
	readonly to: number;
	readonly before: number | null;
	readonly after: number | null;
}

/** Keep document coordinates while separating proven quote/list prefixes from TeX. */
export function projectMathSource(state: EditorState, math: MathExpression): MathSource {
	const opening = state.doc.lineAt(math.from), closing = state.doc.lineAt(math.to);
	const card = quoteContainers(state).filter(item => item.from <= math.from && item.to >= math.to)
		.sort((a, b) => b.depth - a.depth)[0];
	const projected = card ? projectQuoteContent(state, opening.from, closing.to, card.depth) : null;
	const continuation = math.display ? blockContinuationPrefix(state, math.from) : '';
	const lines: MathSourceLine[] = [];
	for (let number = opening.number; number <= closing.number; number++) {
		const line = state.doc.line(number), mapped = projected?.lines[number - opening.number];
		// Lazy quote continuation has no physical prefix; preserve its full TeX text.
		const prefix = mapped?.prefix ?? (card ? mathQuotePrefix(state, line.from, card.depth) ?? '' : '');
		const bodyTab = prefix.endsWith('>') && line.text[prefix.length] === '\t';
		const prefixTo = bodyTab ? line.from + prefix.length : Math.max(mapped ? projected.toSource(mapped.virtualFrom) : line.from + prefix.length,
			math.display && number > opening.number ? blockLineContentFrom(state, number, continuation) : line.from);
		const from = Math.max(math.contentFrom, prefixTo), to = Math.min(math.contentTo, line.to);
		lines.push({ number, prefixFrom: line.from, prefixTo, from, to, text: state.sliceDoc(from, to) });
	}
	const first = lines[0]!.text.trim() ? 0 : 1;
	const end = lines.at(-1)!.text.trim() ? lines.length : lines.length - 1;
	const bodyLines = lines.slice(first, Math.max(first, end));
	const from = bodyLines[0]?.from ?? lines.at(-1)!.from;
	const before = math.from === lines[0]!.prefixTo ? opening.from - 1 : math.from - 1;
	let after = math.to < state.doc.length ? math.to + 1 : null;
	if (after !== null && math.to === closing.to) {
		const next = state.doc.line(closing.number + 1);
		const target = quoteContainers(state).filter(item => item.from <= next.from && item.to >= next.to)
			.sort((a, b) => b.depth - a.depth)[0];
		const targetContent = target ? projectQuoteContent(state, next.from, next.to, target.depth) : null;
		after = targetContent?.toSource(0) ?? next.from;
	}
	return { source: lines.map(line => line.text).join('\n'), lines, bodyLines, from, to: bodyLines.at(-1)?.to ?? from,
		before: before >= 0 ? before : null, after };
}

export function clampMathBody(source: MathSource, position: number): number {
	const clamped = Math.max(source.from, Math.min(source.to, position));
	const line = source.bodyLines.find(row => row.prefixFrom <= clamped && clamped < row.from);
	return line?.from ?? clamped;
}
