import bidiFactory from 'bidi-js';

const bidi = bidiFactory();
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
interface Part { readonly index: number; readonly segment: string; }
interface Distance { readonly dx: number; readonly dy: number; }
interface TextEntry { readonly node: Text; readonly from: number; }
interface Glyph { readonly node: Text; readonly from: number; readonly to: number; readonly rects: readonly DOMRect[]; }
interface Run { readonly node: Text; readonly from: number; readonly to: number; readonly level: number; }
interface TextBox { readonly node: Text; readonly base: number; readonly rect: DOMRect; run?: Run; }
export interface DOMCaret { readonly node: Node; readonly offset: number; }

function nearer(candidate: Distance, previous: Distance | null): boolean {
	return !previous || candidate.dy < previous.dy || candidate.dy === previous.dy && candidate.dx < previous.dx;
}
function distance(rect: DOMRect, x: number, y: number): Distance {
	return { dy: Math.max(rect.top - y, 0, y - rect.bottom), dx: Math.max(rect.left - x, 0, x - rect.right) };
}
function pickGlyph(element: HTMLElement, x: number, y: number, partsFor: (node: Text) => readonly Part[]): Glyph | null {
	const doc = element.ownerDocument;
	const win = doc.defaultView!;
	const range = doc.createRange();
	const walker = doc.createTreeWalker(element, win.NodeFilter.SHOW_TEXT);
	const target = doc.elementFromPoint(x, y);
	let best: { node: Text; distance: Distance } | null = null;
	let nested: { node: Text; distance: Distance } | null = null;
	let box: DOMRect | null = null;
	let scanX = x;
	const score = (rects: DOMRectList): Distance | null => {
		let result: Distance | null = null;
		for (const rect of rects) {
			if (rect.width <= 0 || rect.height <= 0) continue;
			if (box && (rect.right <= box.left || rect.left >= box.right || Math.abs(rect.top - box.top) > 2)) continue;
			// Text-box hit testing uses integer pixel edges; glyph half-widths retain fractional coordinates.
			const dy = Math.max(rect.top - y, 0, y - rect.bottom);
			const dx = Math.max(box ? Math.max(rect.left, box.left) - scanX : Math.floor(rect.left) - scanX,
				0, box ? scanX - Math.min(rect.right, box.right) : scanX - Math.floor(rect.right));
			if (nearer({ dy, dx }, result)) result = { dy, dx };
		}
		return result;
	};
	let node: Node | null;
	while ((node = walker.nextNode())) {
		if (!node.instanceOf(win.Text)) continue;
		range.selectNodeContents(node);
		const candidate = score(range.getClientRects());
		if (candidate && nearer(candidate, nested?.distance ?? null)) nested = { node, distance: candidate };
		if (target && element.contains(target) && node.parentElement !== target) continue;
		if (candidate && nearer(candidate, best?.distance ?? null)) best = { node, distance: candidate };
	}
	// Container padding and line-end whitespace can hit an ancestor with no direct Text children.
	// Preserve the browser's inline hit at fractional glyph edges; padding still uses the nearest text.
	if (nested && (!best || nested.distance.dy < best.distance.dy
		|| nested.distance.dy === best.distance.dy && best.distance.dx >= 1 && nested.distance.dx < best.distance.dx)) best = nested;
	if (!best) return null;
	const text = best.node;
	range.selectNodeContents(text);
	let boxDistance: Distance | null = null;
	for (const rect of range.getClientRects()) {
		if (rect.width <= 0) continue;
		const candidate = distance(rect, Math.trunc(x), y);
		if (nearer(candidate, boxDistance)) { box = rect; boxDistance = candidate; }
	}
	if (!box) return null;
	scanX = Math.min(Math.max(x, box.left + .001), box.right - .001);
	const parts = partsFor(text);
	let from = 0, to = parts.length;
	while (to - from > 1) {
		const middle = Math.floor((from + to) / 2);
		const offset = parts[middle]!.index;
		range.setStart(text, parts[from]!.index); range.setEnd(text, offset);
		const left = score(range.getClientRects());
		range.setStart(text, offset); range.setEnd(text, to === parts.length ? text.length : parts[to]!.index);
		const right = score(range.getClientRects());
		if (!right || left && (left.dy < right.dy || left.dy === right.dy && left.dx <= right.dx)) to = middle;
		else from = middle;
	}
	const part = parts[from]!;
	range.setStart(text, part.index); range.setEnd(text, part.index + part.segment.length);
	return { node: text, from: part.index, to: part.index + part.segment.length, rects: [...range.getClientRects()] };
}

/** Keep the bidi paragraph local when a caller supplies an entire editor root. */
function caretScope(root: HTMLElement, x: number, y: number): HTMLElement | null {
	const doc = root.ownerDocument;
	const win = doc.defaultView!;
	let target = doc.elementFromPoint(x, y);
	if (!target || !root.contains(target)) return null;
	while (target !== root) {
		if (target.instanceOf(win.HTMLElement)) {
			const display = win.getComputedStyle(target).display;
			if (['block', 'list-item', 'flex', 'grid', 'table-cell', 'flow-root', 'inline-block', 'inline-flex', 'inline-grid'].includes(display)) return target;
		}
		target = target.parentElement!;
	}
	return root;
}

interface CaretContext {
	readonly range: Range;
	readonly rtl: boolean;
	readonly entries: readonly TextEntry[];
	readonly levels: Uint8Array;
	readonly partsFor: (node: Text) => readonly Part[];
}
interface GlyphHit { readonly node: Text; readonly from: number; readonly to: number; readonly rect: DOMRect; }

function createCaretContext(element: HTMLElement): CaretContext {
	const doc = element.ownerDocument;
	const win = doc.defaultView!;
	const rtl = win.getComputedStyle(element).direction === 'rtl';
	const range = doc.createRange();
	const partsCache = new Map<Text, readonly Part[]>();
	const partsFor = (node: Text): readonly Part[] => {
		let parts = partsCache.get(node);
		if (!parts) { parts = [...segmenter.segment(node.data)]; partsCache.set(node, parts); }
		return parts;
	};
	const entries: TextEntry[] = [];
	let text = '';
	const visit = (node: Node): void => {
		if (node.instanceOf(win.Text)) { entries.push({ node, from: text.length }); text += node.data; return; }
		if (!node.instanceOf(win.Element)) return;
		const style = win.getComputedStyle(node);
		if (style.display === 'none') return;
		let before = '', after = '';
		if (node !== element) {
			const direction = style.direction === 'rtl';
			// CSS bidi scopes participate in Unicode embedding levels without changing DOM offsets.
			switch (style.unicodeBidi) {
				case 'isolate': before = direction ? '\u2067' : '\u2066'; after = '\u2069'; break;
				case 'bidi-override': before = direction ? '\u202e' : '\u202d'; after = '\u202c'; break;
				case 'embed': before = direction ? '\u202b' : '\u202a'; after = '\u202c'; break;
				case 'isolate-override': before = direction ? '\u2067\u202e' : '\u2066\u202d'; after = '\u202c\u2069'; break;
			}
		}
		text += before;
		for (const child of node.childNodes) visit(child);
		text += after;
	};
	visit(element);
	const levels = bidi.getEmbeddingLevels(text, rtl ? 'rtl' : 'ltr').levels;
	return { range, rtl, partsFor, entries, levels };
}

function directGlyphCaret(context: CaretContext, picked: Glyph, hit: GlyphHit, x: number): DOMCaret | null {
	const { range, rtl, levels } = context;
	const earlyLevel = levels[hit.from]!;
	const direction = !!(earlyLevel % 2);
	const earlyAfter = direction ? x < (hit.rect.left + hit.rect.right) / 2 : x > (hit.rect.left + hit.rect.right) / 2;
	const resultOffset = earlyAfter ? picked.to : picked.from;
	if (!/^\s+$/u.test(picked.node.data.slice(picked.from, picked.to))) {
		if (direction === rtl) return { node: hit.node, offset: resultOffset };
		const adjacent = earlyAfter ? picked.to : picked.from - 1;
		if (adjacent >= 0 && adjacent < picked.node.length && levels[hit.from - picked.from + adjacent] === earlyLevel && !/\s/u.test(picked.node.data[adjacent]!)) {
			range.setStart(hit.node, adjacent); range.setEnd(hit.node, adjacent + 1);
			if ([...range.getClientRects()].some(item => Math.abs(item.top - hit.rect.top) < 2 && item.width > 0)) return { node: hit.node, offset: resultOffset };
		}
	}
	return null;
}

function visualTextBoxes(context: CaretContext, rect: DOMRect): TextBox[] {
	const { range, entries } = context;
	// A full Text Range preserves actual text-box boundaries, including separate word separators.
	const boxes: TextBox[] = [];
	for (const item of entries) {
		range.selectNodeContents(item.node);
		for (const box of range.getClientRects()) {
			if (box.width > 0 && Math.abs(box.top - rect.top) < 2) boxes.push({ node: item.node, base: item.from, rect: box });
		}
	}
	boxes.sort((a, b) => (a.rect.left + a.rect.right) - (b.rect.left + b.rect.right));
	return boxes;
}

function textBoxRun(context: CaretContext, box: TextBox | undefined): Run | undefined {
	const { range, partsFor, levels, rtl } = context;
	if (!box || box.run) return box?.run;
	const parts = partsFor(box.node);
	const intersects = (from: number, to: number): boolean => {
		if (from === to) return false;
		range.setStart(box.node, parts[from]!.index);
		range.setEnd(box.node, to === parts.length ? box.node.length : parts[to]!.index);
		return [...range.getClientRects()].some(item => item.width > 0 && Math.abs(item.top - box.rect.top) < 2
			&& Math.min(item.right, box.rect.right) - Math.max(item.left, box.rect.left) > Math.min(item.width, box.rect.width) * .5);
	};
	let low = 0, high = parts.length;
	while (low < high) { const middle = Math.floor((low + high) / 2); if (intersects(0, middle + 1)) high = middle; else low = middle + 1; }
	const from = low;
	low = from; high = parts.length;
	while (low < high) { const middle = Math.floor((low + high) / 2); if (intersects(middle, parts.length)) low = middle + 1; else high = middle; }
	const to = low;
	const first = parts[from], last = parts[to - 1];
	if (!first || !last) throw new Error('Rendered text box has no grapheme boundary');
	let level = levels[box.base + first.index]!;
	if (parts.slice(from, to).every(part => /^\s+$/u.test(part.segment))) {
		range.setStart(box.node, first.index); range.collapse(true);
		const start = range.getBoundingClientRect();
		range.setStart(box.node, last.index + last.segment.length); range.collapse(true);
		const end = range.getBoundingClientRect();
		const direction = Math.abs(start.left - box.rect.right) < 1.1 ? true : Math.abs(start.left - box.rect.left) < 1.1 ? false
			: Math.abs(end.left - box.rect.left) < 1.1 ? true : Math.abs(end.left - box.rect.right) < 1.1 ? false : null;
		if (direction !== null && direction !== !!(level % 2)) level = rtl ? 1 : 0;
	}
	return box.run = { node: box.node, from: box.base + first.index, to: box.base + last.index + last.segment.length, level };
}

function resolveBidiEdge(context: CaretContext, boxes: readonly TextBox[], hit: GlyphHit, x: number): DOMCaret | null {
	const { rtl, entries } = context;
	const rect = hit.rect;
	const getRun = (box: TextBox | undefined): Run | undefined => textBoxRun(context, box);
	const index = boxes.findIndex(box => box.node === hit.node && rect.left + rect.width / 2 >= box.rect.left && rect.left + rect.width / 2 <= box.rect.right);
	if (index < 0) return null;
	const run = getRun(boxes[index])!;
	const level = run.level;
	const runRTL = !!(level % 2);
	const after = runRTL ? x < (rect.left + rect.right) / 2 : x > (rect.left + rect.right) / 2;
	const left = after === runRTL;
	let offset = after ? hit.to : hit.from;
	let owner = hit.node;
	const setEdge = (target: Run, right: boolean): void => { offset = right !== !!(target.level % 2) ? target.to : target.from; owner = target.node; };
	if (runRTL !== rtl && (offset === run.from || offset === run.to)) {
		const step = left ? 1 : -1;
		const back = getRun(boxes[index - step]);
		if (!back || back.level < level) {
			let nextIndex = index, next: Run | undefined;
			while ((next = getRun(boxes[nextIndex + step])) && next.level >= level) nextIndex += step;
			const target = getRun(boxes[nextIndex])!;
			setEdge(target, left === (target.level % 2 === level % 2));
		} else if (back.level > level) {
			let nextIndex = index - step, next: Run | undefined;
			while ((next = getRun(boxes[nextIndex - step])) && next.level > level) nextIndex -= step;
			setEdge(getRun(boxes[nextIndex])!, left);
		}
	}
	return { node: owner, offset: offset - entries.find(item => item.node === owner)!.from };
}

/** Resolve rendered text without changing DOM selection or starting a browser mouse gesture. */
export function renderedDOMCaretAtPoint(root: HTMLElement, x: number, y: number): DOMCaret | null {
	const element = caretScope(root, x, y);
	if (!element) return null;
	const context = createCaretContext(element);
	const picked = pickGlyph(element, x, y, context.partsFor);
	if (!picked) return null;
	const entry = context.entries.find(item => item.node === picked.node)!;
	const rect = picked.rects.filter(item => item.width > 0).sort((a, b) => {
		const first = distance(a, x, y), second = distance(b, x, y);
		return first.dy - second.dy || first.dx - second.dx;
	})[0]!;
	const hit = { node: picked.node, from: entry.from + picked.from, to: entry.from + picked.to, rect };
	return directGlyphCaret(context, picked, hit, x) ?? resolveBidiEdge(context, visualTextBoxes(context, rect), hit, x);
}
