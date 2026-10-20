import { discoverShorthand, type ShorthandSettings } from './syntax.js';
import { enhanceReadingTildeRuns } from './tilde-reading.js';

const excluded = 'code, pre, kbd, script, style, textarea, sub, sup, s, del, .math, mjx-container, .MathJax, .footnote-ref, .footnote-backref, .paraflow-tilde-reading';
const generated = '.footnote-link, .footnote-ref, .footnote-backref, .math, mjx-container, .MathJax, .mermaid, svg, button';

export function enhanceReadingShorthand(root: HTMLElement, settings: ShorthandSettings, source: string | null): () => void {
	if (source === null || (!settings.subscript && !settings.superscript)) return () => {};
	const ranges = discoverShorthand(source).filter(item => settings[item.kind]);
	const offsets: number[] = [];
	let decoded = '';
	for (let position = 0; position < source.length; position++) {
		const entity = source[position] === '&' ? /^&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);/iu.exec(source.slice(position)) : null;
		if (entity) {
			// eslint-disable-next-line no-unsanitized/method -- The validated character reference cannot contain markup delimiters.
			const text = root.ownerDocument.createRange().createContextualFragment(entity[0]).textContent;
			for (let index = 0; index < text.length; index++) offsets.push(position);
			decoded += text; position += entity[0].length - 1; continue;
		}
		if (source[position] === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/u.test(source[position + 1] ?? '')) position++;
		offsets.push(position); decoded += source[position];
	}
	const walker = root.ownerDocument.createTreeWalker(root, 4);
	const nodes: Text[] = [];
	while (walker.nextNode()) nodes.push(walker.currentNode as Text);
	const restore: Array<() => void> = [];
	let cursor = 0;
	for (const node of nodes) {
		// Rendered layout whitespace and generated labels cannot identify source positions.
		if (!node.data.trim() || node.parentElement?.closest(generated)) continue;
		const index = decoded.indexOf(node.data, cursor);
		if (index < 0) continue;
		cursor = index + node.length;
		if (node.parentElement?.closest(excluded)) continue;
		// Native inline parsing restarts after an escape and can consume our closing
		// caret plus an alphanumeric suffix as a block ID at the end of that owner.
		let text = node.data;
		let recovered = '';
		if (!node.nextSibling) for (const item of ranges) {
			if (item.kind !== 'superscript' || offsets[cursor] !== item.to - 1 || offsets.indexOf(item.from, index) < index) continue;
			const body = source.slice(item.from + 1, item.to - 1);
			let slashes = 0;
			for (let at = body.length - 2; at >= 0 && body[at] === '\\'; at--) slashes++;
			if (slashes % 2 !== 1 || !/[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/u.test(body.at(-1)!)) continue;
			const suffix = /^\^[a-zA-Z0-9-]+(?=$|[\r\n*_~=\]])/u.exec(decoded.slice(cursor));
			if (!suffix) continue;
			recovered = suffix[0]; text += recovered; cursor += recovered.length; break;
		}
		const matches = ranges.filter(item => {
			const start = offsets.indexOf(item.from, index);
			const end = offsets.indexOf(item.to - 1, index);
			return start >= index && end < cursor && end >= start;
		});
		if (!matches.length) continue;
		const replacement: Node[] = [];
		let previous = 0;
		for (const item of matches) {
			const start = offsets.indexOf(item.from, index) - index;
			const end = offsets.indexOf(item.to - 1, index) - index + 1;
			if (start > previous) replacement.push(root.ownerDocument.createTextNode(text.slice(previous, start)));
			const element = root.ownerDocument.createElement(item.kind === 'subscript' ? 'sub' : 'sup');
			element.className = 'paraflow-shorthand-reading';
			const rendered = text.slice(start + 1, end - 1).replace(/\\([ \t])/gu, '$1');
			element.textContent = rendered;
			const literal = node.data.slice(start, end);
			restore.push(() => {
				if (!element.parentNode) return;
				const marker = item.kind === 'subscript' ? '~' : '^';
				const text = element.textContent === rendered ? literal : `${marker}${element.textContent}${marker}`;
				element.replaceWith(root.ownerDocument.createTextNode(text));
			});
			replacement.push(element);
			previous = end;
		}
		if (previous < text.length) {
			const tail = root.ownerDocument.createTextNode(text.slice(previous)); replacement.push(tail);
			if (recovered) {
				const original = tail.data;
				restore.push(() => { if (tail.data === original) tail.remove(); });
			}
		}
		node.replaceWith(...replacement);
	}
	const restoreTildes = settings.subscript ? enhanceReadingTildeRuns(root, source) : () => {};
	return () => { restoreTildes(); for (const undo of restore) undo(); };
}
