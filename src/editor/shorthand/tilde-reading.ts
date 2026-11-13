import { createDetachedEl } from '../../dom';
import { GFM, parser } from '@lezer/markdown';
import { discoverTildeRuns, type TildeRun } from './syntax.js';
import { scanMathRanges } from '../math/range-scanner.js';

const markdown = parser.configure(GFM);
const excluded = 'code, pre, kbd, script, style, textarea, sub, sup, .math, mjx-container, .MathJax, .footnote-ref, .footnote-backref, .paraflow-tilde-reading';
const generated = '.math, mjx-container, .MathJax, .footnote-ref, .footnote-backref, .paraflow-tilde-reading';

/** Empty native strike has no text offset; retain its source occurrence before normal text matching. */
function restoreEmptyStrikes(root: HTMLElement, source: string, runs: readonly TildeRun[], owns: (element: Element) => boolean) {
	const undo: Array<() => void> = [];
	const restored = new Map<number, HTMLElement>();
	const cleanup = () => { for (const restore of undo.reverse()) restore(); };
	if (!root.querySelector('s:empty, del:empty')) return { restored, cleanup };
	const math = scanMathRanges(source);
	const opaque = [...math.opaque, ...math.expressions];
	const literal: Array<{ from: number; to: number }> = [...math.expressions];
	markdown.parse(source).iterate({ enter(node) {
		if (['InlineCode', 'FencedCode', 'CodeBlock', 'Comment', 'URL', 'Autolink', 'LinkTitle', 'Image'].includes(node.name)) {
			literal.push({ from: node.from, to: node.to }); return false;
		}
		return true;
	} });
	const candidates = [...source.matchAll(/~{4,}|<(s|del)\b(?:"[^"]*"|'[^']*'|[^'">])*><\/\1\s*>/giu)].filter(match => {
		if ([...literal, ...(match[0][0] === '<' ? [] : opaque)].some(range => range.from <= match.index && match.index + match[0].length <= range.to)) return false;
		let slashes = 0;
		for (let at = match.index - 1; at >= 0 && source[at] === '\\'; at--) slashes++;
		return slashes % 2 === 0;
	});
	const offsets: number[] = [];
	let decoded = '';
	for (let position = 0; position < source.length; position++) {
		const entity = source[position] === '&' ? /^&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);/iu.exec(source.slice(position)) : null;
		if (entity) {
			// eslint-disable-next-line no-unsanitized/method -- A validated character reference cannot contain markup.
			const value = root.ownerDocument.createRange().createContextualFragment(entity[0]).textContent;
			for (let index = 0; index < value.length; index++) offsets.push(position);
			decoded += value; position += entity[0].length - 1; continue;
		}
		if (source[position] === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/u.test(source[position + 1] ?? '')) position++;
		offsets.push(position); decoded += source[position];
	}
	const walker = root.ownerDocument.createTreeWalker(root, 1 | 4);
	const nodes: Node[] = [];
	while (walker.nextNode()) nodes.push(walker.currentNode);
	const consumed = new Set<Node>();
	let cursor = 0;
	for (const node of nodes) {
		if (consumed.has(node)) continue;
		if (node.nodeType === 3) {
			const text = node as Text;
			if (!text.data.trim() || text.parentElement?.closest(generated)) continue;
			const found = decoded.indexOf(text.data, cursor);
			if (found >= 0) cursor = found + text.length;
			continue;
		}
		const element = node as HTMLElement;
		if (element.matches('.paraflow-tilde-reading')) {
			const run = runs.find(run => run.from >= (offsets[cursor] ?? source.length));
			if (run) { cursor = offsets.findIndex(offset => offset >= run.to); if (cursor < 0) cursor = decoded.length; }
			continue;
		}
		if (!element.matches('s:empty, del:empty') || element.childNodes.length || element.closest(generated)) continue;
		const candidate = candidates.find(match => match.index >= (offsets[cursor] ?? source.length));
		if (!candidate) continue;
		cursor = offsets.findIndex(offset => offset >= candidate.index + candidate[0].length);
		if (cursor < 0) cursor = decoded.length;
		if (candidate[0][0] !== '~') continue;
		const group: HTMLElement[] = [element];
		for (let next = element.nextSibling; group.length < Math.floor(candidate[0].length / 4) && next; next = next.nextSibling) {
			if (next.nodeType === 3 && !next.textContent) continue;
			if (next.nodeType !== 1 || next.childNodes.length || !(next as Element).matches('s:empty, del:empty')) break;
			group.push(next as HTMLElement);
		}
		if (group.length !== Math.floor(candidate[0].length / 4)) continue;
		for (const item of group.slice(1)) consumed.add(item);
		const remainder = candidate[0].length % 4;
		const tail = group.at(-1)!.nextSibling;
		if (remainder && (tail?.nodeType !== 3 || !tail.textContent?.startsWith('~'.repeat(remainder)))) continue;
		const run = runs.find(run => run.from <= candidate.index && candidate.index + candidate[0].length <= run.to);
		if (!run || !owns(element) || element.closest(excluded)) continue;
		const range = root.ownerDocument.createRange();
		range.setStartBefore(element);
		if (remainder) range.setEnd(tail!, remainder); else range.setEndAfter(group.at(-1)!);
		const saved = range.extractContents();
		const replacement = createDetachedEl(root.ownerDocument, 'span');
		replacement.className = 'paraflow-native-tilde-source';
		replacement.textContent = candidate[0];
		range.insertNode(replacement); restored.set(candidate.index, replacement);
		undo.push(() => replacement.replaceWith(saved));
	}
	return { restored, cleanup };
}

function renderRun(root: HTMLElement, source: string, run: TildeRun): HTMLElement {
	const replacement = createDetachedEl(root.ownerDocument, 'span');
	replacement.className = 'paraflow-tilde-reading';
	let cursor = run.from;
	for (const part of run.parts) {
		replacement.append(source.slice(cursor, part.from));
		const body = createDetachedEl(root.ownerDocument, part.kind === 'subscript' ? 'sub' : 'del');
		body.textContent = source.slice(part.bodyFrom, part.bodyTo).replace(/\\([ \t!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/gu, '$1'); replacement.append(body); cursor = part.to;
	}
	replacement.append(source.slice(cursor, run.to));
	return replacement;
}

/** Normalize a native strike split and a literal text run through the same source delimiter model. */
export function enhanceReadingTildeRuns(root: HTMLElement, source: string, owns: (element: Element) => boolean = () => true): () => void {
	const runs = discoverTildeRuns(source);
	if (!runs.length) return () => {};
	const empty = restoreEmptyStrikes(root, source, runs, owns);
	const undo: Array<() => void> = [empty.cleanup];
	let searchFrom = 0;
	let sourceFrom = 0;
	for (const run of runs) {
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
		const restored = empty.restored.get(run.from);
		if (restored) {
			searchFrom = nodes.find(item => restored.contains(item.node))!.from;
		}
		// Advance over earlier identical literals too: escaping or code changes eligibility, not occurrence identity.
		let earlier = source.indexOf(raw, sourceFrom);
		while (!restored && earlier >= 0 && earlier < run.from) {
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
		if (!owns(first.node.parentElement!) || !owns(last.node.parentElement!)) { searchFrom = end; sourceFrom = run.to; continue; }
		if (first.node.parentElement?.closest(excluded) || last.node.parentElement?.closest(excluded)) continue;
		const range = root.ownerDocument.createRange();
		range.setStart(first.node, match.index - first.from); range.setEnd(last.node, end - last.from);
		const firstStrike = first.node.parentElement?.closest('s, del, .paraflow-native-tilde-source');
		const lastStrike = last.node.parentElement?.closest('s, del, .paraflow-native-tilde-source');
		if (firstStrike && range.startOffset === 0 && firstStrike.firstChild === first.node) range.setStartBefore(firstStrike);
		if (lastStrike && range.endOffset === last.node.length && lastStrike.lastChild === last.node) range.setEndAfter(lastStrike);
		const saved = range.extractContents();
		const replacement = renderRun(root, source, run); range.insertNode(replacement);
		undo.push(() => { if (replacement.parentNode) replacement.replaceWith(saved); });
		searchFrom = match.index + replacement.textContent.length;
		sourceFrom = run.to;
	}
	return () => { for (const restore of undo.reverse()) restore(); };
}
