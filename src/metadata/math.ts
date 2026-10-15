import { scanMathRanges } from '../editor/math/range-scanner.js';
import { mathSourceMarkers } from '../editor/math/transient-source.js';

/** Native parsing sees opaque inline formulas; published coordinates remain source coordinates. */
export function adaptMetadataMathSource(source: string): { source: string; dollars: readonly number[]; restore<T>(value: T): T } | null {
	if (!source.includes('$')) return null;
	const index = scanMathRanges(source), protectedRanges = [...index.expressions, ...index.opaque].sort((a, b) => a.from - b.from);
	const dollars: number[] = [];
	let rangeIndex = 0;
	for (const match of source.matchAll(/\$/gu)) {
		const at = match.index;
		while (protectedRanges[rangeIndex] && protectedRanges[rangeIndex]!.to <= at) rangeIndex++;
		if (protectedRanges[rangeIndex] && protectedRanges[rangeIndex]!.from <= at) continue;
		let slashes = 0; for (let before = at - 1; before >= 0 && source[before] === '\\'; before--) slashes++;
		if (slashes % 2 === 0) dollars.push(at);
	}
	const inline = index.expressions.filter(math => !math.display && math.contentFrom - math.from === 2);
	if (!dollars.length && !inline.length) return null;
	const allocate = mathSourceMarkers(source), marker = allocate(), replacements = new Map<string, string>([[marker, '$']]);
	const edits = [...dollars.map(at => ({ from: at, to: at + 1, marker })), ...inline.map(math => {
		const token = allocate(); replacements.set(token, source.slice(math.from, math.to));
		// A token can extend an adjacent native tag, just like a masked dollar.
		dollars.push(math.from);
		return { from: math.from, to: math.to, marker: token };
	})].sort((a, b) => a.from - b.from);
	const parts: string[] = [];
	let previous = 0;
	for (const edit of edits) { parts.push(source.slice(previous, edit.from), edit.marker); previous = edit.to; }
	parts.push(source.slice(previous));
	const bom = Number(source.startsWith('\uFEFF')), original = source.slice(bom);
	const lineStarts = [0];
	for (let at = original.indexOf('\n'); at >= 0; at = original.indexOf('\n', at + 1)) lineStarts.push(at + 1);
	const position = (value: Position): Position => {
		let offset = value.offset + bom, removed = 0;
		for (const edit of edits) {
			const from = edit.from - removed;
			if (offset <= from) break;
			removed += edit.to - edit.from - 1;
		}
		offset += removed - bom;
		let low = 0, high = lineStarts.length;
		while (low + 1 < high) { const middle = (low + high) >>> 1; if (lineStarts[middle]! <= offset) low = middle; else high = middle; }
		return { ...value, offset, line: low, col: offset - lineStarts[low]! };
	};
	const text = (value: string): string => {
		for (const [token, original] of replacements) value = value.replaceAll(token, () => original);
		return value;
	};
	function restore(value: unknown): unknown {
		if (typeof value === 'string') return text(value);
		if (Array.isArray(value)) return value.map(restore);
		if (value && typeof value === 'object') {
			if (inline.length && 'offset' in value && 'line' in value && 'col' in value && typeof value.offset === 'number') return position(value as Position);
			return Object.fromEntries(Object.entries(value).map(([key, item]) => [text(key), key === 'frontmatter' ? item : restore(item)]));
		}
		return value;
	}
	return { source: parts.join(''), dollars, restore: <T>(value: T): T => restore(value) as T };
}

interface Position { line: number; col: number; offset: number }
interface Tag { tag: string; position: { start: Position; end: Position } }
/** Dollar is also a native tag terminator; the opaque marker is not. Ask the
 * native parser about just the affected source words, retaining its tag rules. */
async function restoreTagBoundaries(result: object, source: string, dollars: readonly number[], parse: (source: string) => Promise<object | null | undefined>): Promise<void> {
	const metadata = result as { tags?: Tag[] };
	if (!metadata.tags?.length) return;
	// Native metadata offsets omit an initial UTF-8 BOM, including in CRLF files.
	if (source.startsWith('\uFEFF')) { source = source.slice(1); dollars = dollars.map(at => at - 1); }
	const words = new Map<number, { from: number; to: number }>();
	for (const at of dollars) {
		let from = at, to = at + 1;
		while (from > 0 && !/\s/u.test(source[from - 1]!)) from--;
		while (to < source.length && !/\s/u.test(source[to]!)) to++;
		if (metadata.tags.some(tag => from <= tag.position.start.offset && tag.position.start.offset < to)) words.set(from, { from, to });
	}
	if (!words.size) return;
	let input = '';
	const ranges = [...words.values()].map(word => { const start = input.length; input += source.slice(word.from, word.to) + '\n\n'; return { ...word, start }; });
	const parsed = await parse(input) as { tags?: Tag[] } | null | undefined;
	if (!parsed) throw new Error('Native tag metadata parsing failed');
	const tags = metadata.tags.filter(tag => !ranges.some(range => range.from <= tag.position.start.offset && tag.position.start.offset < range.to));
	for (const tag of parsed.tags ?? []) {
		const range = ranges.find(range => range.start <= tag.position.start.offset && tag.position.end.offset <= range.start + range.to - range.from);
		if (!range) continue;
		const position = (at: number): Position => {
			const offset = range.from + at - range.start, before = source.slice(0, offset);
			return { offset, line: before.split('\n').length - 1, col: offset - (source.lastIndexOf('\n', offset - 1) + 1) };
		};
		tags.push({ ...tag, position: { start: position(tag.position.start.offset), end: position(tag.position.end.offset) } });
	}
	if (tags.length) metadata.tags = tags.sort((a, b) => a.position.start.offset - b.position.start.offset);
	else delete metadata.tags;
}

/** Verified private host boundary; native code still owns queueing and publication. */
export interface MathMetadataHost {
	work: (this: MathMetadataHost, input: ArrayBuffer) => Promise<object | null | undefined>;
	saveMetaCache: (this: MathMetadataHost, hash: string, value: object | null | undefined) => void;
	metadataCache: Record<string, object | undefined>;
	fileCache: Record<string, { hash: string }>;
	workQueue: { queue<T>(task: () => Promise<T>): Promise<T> };
}

export function installMathMetadataAdapter(host: MathMetadataHost, reindex: (paths: string[]) => Promise<void>) {
	if (typeof host.work !== 'function' || typeof host.saveMetaCache !== 'function' || typeof host.workQueue?.queue !== 'function' || !host.metadataCache || !host.fileCache) {
		throw new Error('This Obsidian metadata parser interface is unsupported');
	}
	const nativeWork = host.work, nativeSave = host.saveMetaCache;
	const adaptedResults = new WeakSet<object>(), owned = new Map<string, object>();
	let alive = true;
	const work: MathMetadataHost['work'] = async function(this: MathMetadataHost, input) {
		if (!alive) return nativeWork.call(this, input);
		const source = new TextDecoder('utf-8', { ignoreBOM: true }).decode(input), adapted = adaptMetadataMathSource(source);
		if (!adapted) return nativeWork.call(this, input);
		const result = await nativeWork.call(this, new TextEncoder().encode(adapted.source).buffer);
		// The original buffer was not transferred; disposal must publish native rules.
		if (!alive) return nativeWork.call(this, input);
		if (!result) return result;
		const restored = adapted.restore(result);
		await restoreTagBoundaries(restored, source, adapted.dollars, value => nativeWork.call(this, new TextEncoder().encode(value).buffer));
		if (!alive) return nativeWork.call(this, input);
		adaptedResults.add(restored); return restored;
	};
	const save: MathMetadataHost['saveMetaCache'] = function(this: MathMetadataHost, hash, value) {
		if (value && adaptedResults.has(value)) {
			// Never persist adapted semantics under a native raw-source hash. Missing
			// disk entries reindex normally on restart, including with the plugin off.
			nativeSave.call(this, hash, null);
			this.metadataCache[hash] = value; owned.set(hash, value);
		} else { owned.delete(hash); nativeSave.call(this, hash, value); }
	};
	host.work = work; host.saveMetaCache = save;
	let closing: Promise<void> | null = null;
	return {
		get active(): boolean { return alive; },
		invalidate(hash: string): void { host.saveMetaCache(hash, null); },
		destroy(): Promise<void> {
			if (closing) return closing;
			alive = false;
			if (host.work === work) host.work = nativeWork;
			// Keep the save hook until native continuations have published late results.
			closing = host.workQueue.queue(() => Promise.resolve()).then(async () => {
				if (host.saveMetaCache === save) host.saveMetaCache = nativeSave;
				const hashes = new Set<string>();
				for (const [hash, value] of owned) if (host.metadataCache[hash] === value) { nativeSave.call(host, hash, null); hashes.add(hash); }
				owned.clear();
				await reindex(Object.entries(host.fileCache).filter(([, file]) => hashes.has(file.hash)).map(([path]) => path));
			});
			return closing;
		},
	};
}
