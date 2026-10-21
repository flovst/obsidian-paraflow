import { Annotation, Text, type EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { EnhancementSettings } from '../../enhancement-settings.js';
import { discoverParagraphAuthority } from '../paragraph/syntax.js';
import {codeDraft} from './draft-state.js';
import { acceptedMath, discoverMath, type MathExpression } from '../math/syntax.js';
import { pendingMath, type PendingMathRange } from '../math/candidate-ranges.js';
import { createRangeQuery } from '../math/range-query.js';
import { maskMathSource } from '../math/source-mask.js';
import { codeBlocksIn, type CodeBlock } from './source-scan.js';

export type CodeBlockOptions = Pick<EnhancementSettings, 'codeWordWrap' | 'codeLineNumbers'> & Partial<Pick<EnhancementSettings, 'codeLanguagePosition'>>;
export const codeBlockEdit = Annotation.define<boolean>();
const owned = new WeakMap<Text, { tree: ReturnType<typeof syntaxTree>; draft:number|null; draftTo:number|null; accepted: readonly MathExpression[]; pending: readonly PendingMathRange[]; blocks: CodeBlock[] }>();

/** An ordinary opener preserves block separation; blank TeX rows cannot start code. */
function codeSourceWithoutMath(doc: Text, expressions: readonly MathExpression[]): Text {
	const masked=maskMathSource(doc.toString(),expressions,' '), parts: string[]=[];
	let from=0;
	for(const expression of expressions) {
		parts.push(masked.slice(from,expression.from),'x');
		from=expression.from+1;
	}
	parts.push(masked.slice(from));
	return Text.of(parts.join('').split('\n'));
}

export function discoverCodeBlocks(state: EditorState): CodeBlock[] {
	const tree=syntaxTree(state);
	const draft=state.facet(codeDraft);
	const accepted=state.facet(acceptedMath), pending=state.facet(pendingMath);
	const cached=owned.get(state.doc);
	if(cached?.tree===tree&&cached.draft===(draft?.from??null)&&cached.draftTo===(draft?.to??null)&&cached.accepted===accepted&&cached.pending===pending)return cached.blocks;
	const expressions=discoverMath(state), math=createRangeQuery(expressions);
	const definitions=discoverParagraphAuthority(state).blocks.filter(block=>block.kind==='footnote-definition');
	const hostMarkerLines = new Set<number>();
	const hostCodeLines = new Set<number>();
	tree.iterate({ enter(node) {
		const tokens = node.name.split(/[\s_]+/u);
		const line = state.doc.lineAt(node.from);
		if (tokens.includes('hmd-indented-code') && !tokens.includes('hmd-list-indent')) hostCodeLines.add(line.from);
		if (tokens.includes('HyperMD-list-line') && !tokens.includes('HyperMD-list-line-nobullet') &&
			/^[ \t]*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+/u.test(line.text)) hostMarkerLines.add(line.from);
	} });
	// Only the pending opener is literal; existing suffix blocks retain their own grammar.
	const source=draft?state.doc.replace(draft.from,draft.to,Text.of([' '.repeat(draft.to-draft.from)])):state.doc;
	let parsed=codeBlocksIn(source);
	// Reparse the exceptional overlap so genuine code after TeX retains its own extent.
	if(parsed.some(block=>math.overlaps(block.from,block.to)))parsed=codeBlocksIn(codeSourceWithoutMath(source,expressions));
	const blocks=parsed.flatMap(block=>{
		if (definitions.some(definition=>block.from<=definition.to && block.to>=definition.from)) return [];
		if (!block.indented || !hostMarkerLines.has(block.from) || hostCodeLines.has(block.from)) return [block];
		// HyperMD owns the marker row as list body even when Lezer treats its wide separator as code.
		// Later source lines can still contain genuine list code and retain their own projection.
		const first = block.lines.findIndex((line,index)=>index>0 && /\S/u.test(state.sliceDoc(line.from,line.to)));
		if (first<0) return [];
		const lines = block.lines.slice(first).map((line,index)=>({...line,number:index+1}));
		return [{...block,from:lines[0]!.from,lines}];
	});
	if(draft)blocks.push({from:draft.from,to:draft.to,barAt:draft.to,closed:false,indented:false,lines:[]});
	for(const definition of definitions) {
		const first=state.doc.lineAt(definition.from).number;
		const last=state.doc.lineAt(definition.to).number;
		const content: string[]=[];
		for(let number=first;number<=last;number++) {
			const text=state.doc.line(number).text;
			if(number===first)content.push(text.replace(/^ {0,3}\[\^[^\s[\]]+\]:[ \t]?/u,''));
			else {
				let index=0,columns=0;
				while(columns<4 && (text[index]===' ' || text[index]==='\t')) {
					columns=text[index]==='\t' ? columns+4-columns%4 : columns+1;
					index++;
				}
				content.push(text.slice(index));
			}
		}
		// Four columns belong to the footnote container, not to indented code.
		const body=Text.of(content);
		const originalLine=(position:number)=>state.doc.line(first+body.lineAt(position).number-1);
		const originalPosition=(position:number)=>{
			const line=body.lineAt(position),original=originalLine(position);
			return original.to-line.length+position-line.from;
		};
		for(const block of codeBlocksIn(body)) {
			// A fence on the definition marker's own line remains native-owned.
			if(body.lineAt(block.from).number===1)continue;
			blocks.push({...block,from:originalLine(block.from).from,to:originalPosition(block.to),
				barAt:block.closed ? originalLine(block.barAt).from : originalPosition(block.barAt),
				lines:block.lines.map(line=>({from:originalLine(line.from).from,to:originalLine(line.to).to,number:line.number,
					contentFrom: originalPosition(line.contentFrom ?? line.from)})),
			});
		}
	}
	// HyperMD's imported indented-code classification can differ from Lezer inside lists.
	// Its explicit code token establishes code ownership; a bare Tab alone does not.
	const hostLines = new Map<number, { from: number; to: number; contentFrom: number; listDepth: number }>();
	tree.iterate({ enter(node) {
		const tokens = node.name.split(/[\s_]+/u);
		if (!tokens.includes('hmd-indented-code') || tokens.includes('hmd-list-indent')) return;
		const line = state.doc.lineAt(node.from);
		if (math.overlaps(line.from, line.to)) return;
		if(draft&&line.from>=draft.from&&line.from<=draft.end)return;
		if (blocks.some(block => block.from <= line.from && line.from < block.to)) return;
		if (definitions.some(definition => definition.from <= line.to && line.from <= definition.to)) return;
		let listDepth = 0;
		for (let ancestor = node.node.parent; ancestor; ancestor = ancestor.parent) {
			const level = /(?:^|[\s_])HyperMD-list-line-(\d+)(?:$|[\s_])/u.exec(ancestor.name);
			if (level) { listDepth = Number(level[1]); break; }
		}
		// Imported host code uses the first bare Tab as its code prefix. Later Tabs are code.
		const tabPrefix = /^[ ]*\t/u.exec(line.text);
		hostLines.set(line.number, { from: line.from, to: line.to,
			contentFrom: tabPrefix ? line.from + tabPrefix[0].length : node.from, listDepth });
	} });
	let hostBlock: CodeBlock | null = null;
	let previousNumber = -1;
	for (const [number, line] of [...hostLines].sort(([left], [right]) => left - right)) {
		if (!hostBlock || number !== previousNumber + 1 || hostBlock.listDepth !== line.listDepth) {
			hostBlock = { from: line.from, to: line.to, barAt: line.to, closed: false, indented: true, listDepth: line.listDepth, lines: [] };
			blocks.push(hostBlock);
		}
		hostBlock.lines.push({ from: line.from, to: line.to, contentFrom: line.contentFrom, number: hostBlock.lines.length + 1 });
		hostBlock.to = line.to;
		hostBlock.barAt = line.to;
		previousNumber = number;
	}
	const result=blocks.filter(block=>!math.overlaps(block.from,block.to)).sort((left,right)=>left.from-right.from);
	owned.set(state.doc,{tree,draft:draft?.from??null,draftTo:draft?.to??null,accepted,pending,blocks:result});
	return result;
}
