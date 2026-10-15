import { Facet, type EditorState, type Extension, type Text } from '@codemirror/state';
import { parser } from '@lezer/markdown';
import { Parser, type Input, type TreeFragment } from '@lezer/common';
import { codeDraft, codeDraftState, type CodeDraft } from './draft-state.js';

export interface CodeParserRange { from: number; to: number }
export interface CodeParserSource { masks: readonly CodeParserRange[]; opaque: readonly CodeParserRange[] }
const empty: CodeParserSource = { masks: [], opaque: [] };
export const codeParserSource = Facet.define<CodeParserSource, CodeParserSource>({ combine: values => values[0] ?? empty });

/** Replace only payload bytes: Markdown container prefixes and UTF-16 offsets survive. */
export function maskCodeSource(source: string, ranges: readonly CodeParserRange[]): string {
	let result = '', position = 0;
	for (const range of ranges) {
		result += source.slice(position, range.from) + source.slice(range.from, range.to).replace(/[^\r\n]/gu, char => 'x'.repeat(char.length));
		position = range.to;
	}
	return result + source.slice(position);
}

export function codeDraftMask(source: string, draft: CodeDraft | null): readonly CodeParserRange[] {
	if (!draft) return [];
	const opening = source.slice(draft.from, draft.to), fence = /`{3,}|~{3,}/u.exec(opening);
	return fence ? [{ from: draft.from + fence.index, to: draft.to }] : [];
}

/** Virtual content keeps its real document while parsing the same literal draft opener. */
export function codeDraftParser(native: Parser, masks: readonly CodeParserRange[]): Parser {
	if (!masks.length) return native;
	return new class extends Parser {
		createParse(input: Input, fragments: readonly TreeFragment[], ranges: readonly CodeParserRange[]) {
			const source = maskCodeSource(input.read(0, input.length), masks);
			return native.startParse({ length: source.length, lineChunks: false,
				chunk: from => source.slice(from), read: (from, to) => source.slice(from, to) }, fragments, ranges);
		}
	}();
}

/** Lezer proves code ownership without consulting the native tree or presentation fields. */
export function scanCodeParserSource(source: string, draft: CodeDraft | null): CodeParserSource {
	// Keep command ownership on the literal opener, without exposing its backticks to native styling.
	const masks = [...codeDraftMask(source, draft)], opaque: CodeParserRange[] = [...masks];
	const normalized = maskCodeSource(source, masks);
	parser.parse(normalized).iterate({ enter(ref) {
		if (ref.name !== 'FencedCode') return;
		let quoted = false;
		for (let node = ref.node.parent; node; node = node.parent) if (node.name === 'Blockquote') quoted = true;
		if (!quoted) return false;
		const info = ref.node.getChild('CodeInfo');
		const language = info ? normalized.slice(info.from, info.to).trim().split(/\s/u)[0]! : '';
		if (/^(?:mermaid|math|latex|ad-|dataview|dataviewjs|query|tasks|chart|plantuml|excalidraw|transclusion)(?:$|-)/iu.test(language)) return false;
		for (let child = ref.node.firstChild; child; child = child.nextSibling) {
			if (!/^(?:CodeMark|CodeInfo|CodeText)$/u.test(child.name)) continue;
			masks.push({ from: child.from, to: child.to });
			opaque.push({ from: child.from, to: child.to });
		}
		return false;
	} });
	return { masks: masks.sort((a, b) => a.from - b.from), opaque };
}

const sources = new WeakMap<Text, { from: number | undefined; to: number | undefined; source: CodeParserSource }>();
export function createCodeParserSource(): Extension {
	return codeParserSource.compute(['doc', codeDraftState], (state: EditorState) => {
		if (!state.field(codeDraftState).active) return empty;
		const draft = state.facet(codeDraft), cached = sources.get(state.doc);
		if (cached && cached.from === draft?.from && cached.to === draft?.to) return cached.source;
		const source = scanCodeParserSource(state.sliceDoc(), draft);
		sources.set(state.doc, { from: draft?.from, to: draft?.to, source });
		return source;
	});
}
