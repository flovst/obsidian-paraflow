import { GFM, parser } from '@lezer/markdown';
import { discoverTildeRuns } from './syntax.js';

const markdown = parser.configure(GFM);
const excluded = 'code, pre, kbd, script, style, textarea, sub, sup, .math, mjx-container, .MathJax, .footnote-ref, .footnote-backref, .paraflow-tilde-reading';

/** Normalize a native strike split and a literal text run through the same source delimiter model. */
export function enhanceReadingTildeRuns(root: HTMLElement, source: string): () => void {
	const undo: Array<() => void> = [];
	let searchFrom = 0;
	let sourceFrom = 0;
	for (const run of discoverTildeRuns(source)) {
		const raw = source.slice(run.from, run.to);
		const native = [...raw];
		markdown.parse(`x ${raw}`).iterate({ enter(node) {
			if (node.name === 'StrikethroughMark') native.fill('', node.from - 2, node.to - 2);
		} });
		const walker = root.ownerDocument.createTreeWalker(root, 4);
		const nodes: Array<{ node: Text; from: number; to: number }> = [];
		let text = '';
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			nodes.push({ node, from: text.length, to: text.length + node.length }); text += node.data;
		}
		// Advance over earlier identical literals too: escaping or code changes eligibility, not occurrence identity.
		let earlier = source.indexOf(raw, sourceFrom);
		while (earlier >= 0 && earlier < run.from) {
			const literal = text.indexOf(raw, searchFrom);
			if (literal >= 0) searchFrom = literal + raw.length;
			earlier = source.indexOf(raw, earlier + raw.length);
		}
		const candidates = [raw, native.join('')].map(value => value.replace(/\\([ \t!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/gu, '$1')).map(value => ({ value, index: text.indexOf(value, searchFrom) }))
			.filter(match => match.index >= 0).sort((a, b) => a.index - b.index || b.value.length - a.value.length);
		const match = candidates[0];
		if (!match) continue;
		const end = match.index + match.value.length;
		const first = nodes.find(item => item.from <= match.index && item.to > match.index)!;
		const last = nodes.find(item => item.from < end && item.to >= end)!;
		if (first.node.parentElement?.closest(excluded) || last.node.parentElement?.closest(excluded)) continue;
		const range = root.ownerDocument.createRange();
		range.setStart(first.node, match.index - first.from); range.setEnd(last.node, end - last.from);
		const firstStrike = first.node.parentElement?.closest('s, del');
		const lastStrike = last.node.parentElement?.closest('s, del');
		if (firstStrike && range.startOffset === 0 && firstStrike.firstChild === first.node) range.setStartBefore(firstStrike);
		if (lastStrike && range.endOffset === last.node.length && lastStrike.lastChild === last.node) range.setEndAfter(lastStrike);
		const saved = range.extractContents();
		const replacement = root.ownerDocument.createElement('span');
		replacement.className = 'paraflow-tilde-reading';
		let cursor = run.from;
		for (const part of run.parts) {
			replacement.append(source.slice(cursor, part.from));
			const body = root.ownerDocument.createElement(part.kind === 'subscript' ? 'sub' : 'del');
			body.textContent = source.slice(part.bodyFrom, part.bodyTo).replace(/\\([ \t!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/gu, '$1'); replacement.append(body); cursor = part.to;
		}
		replacement.append(source.slice(cursor, run.to)); range.insertNode(replacement);
		undo.push(() => { if (replacement.parentNode) replacement.replaceWith(saved); });
		searchFrom = match.index + replacement.textContent.length;
		sourceFrom = run.to;
	}
	return () => { for (const restore of undo.reverse()) restore(); };
}
