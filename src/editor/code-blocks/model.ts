import { Annotation, Text, type EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { parser } from '@lezer/markdown';
import type { EnhancementSettings } from '../../enhancement-settings.js';
import { discoverParagraphAuthority } from '../paragraph/syntax.js';
import {codeDraft} from './draft-state.js';

export type CodeBlockOptions = Pick<EnhancementSettings, 'codeWordWrap' | 'codeLineNumbers'> & Partial<Pick<EnhancementSettings, 'codeLanguagePosition'>>;
export const codeBlockEdit = Annotation.define<boolean>();
export interface CodeBlock {
	from: number;
	to: number;
	barAt: number;
	closed: boolean;
	indented: boolean;
	listDepth?: number;
	listTask?: boolean;
	listOrderedTask?: boolean;
	lines: Array<{from: number; to: number; number: number; contentFrom?: number}>;
}

export function isRenderedCodeLanguage(language: string): boolean {
	return /^(?:mermaid|math|latex|ad-|dataview|dataviewjs|query|tasks|chart|plantuml|excalidraw|transclusion)(?:$|-)/iu.test(language);
}

const discovered = new WeakMap<Text, CodeBlock[]>();
const owned = new WeakMap<Text, { tree: ReturnType<typeof syntaxTree>; draft:number|null; blocks: CodeBlock[] }>();

export function discoverCodeBlocks(state: EditorState): CodeBlock[] {
	const tree=syntaxTree(state);
	const draft=state.facet(codeDraft);
	const cached=owned.get(state.doc);
	if(cached?.tree===tree&&cached.draft===(draft?.from??null))return cached.blocks;
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
	const parsed=draft?codeBlocksIn(state.doc.replace(draft.from,draft.to,Text.of([' '.repeat(draft.to-draft.from)]))):codeBlocksIn(state.doc);
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
	blocks.sort((left,right)=>left.from-right.from);
	owned.set(state.doc,{tree,draft:draft?.from??null,blocks});
	return blocks;
}

export function codeBlocksIn(doc: Text): CodeBlock[] {
	const state = { doc };
	const cached = discovered.get(state.doc);
	if (cached) return cached;
	const source=state.doc.toString();
	const blocks: CodeBlock[]=[];
	parser.parse(source).iterate({enter(node) {
		const fenced=node.name==='FencedCode';
		if(!fenced && node.name!=='CodeBlock')return;
		let contentFrom=node.from;
		if(!fenced && node.node.parent?.name==='ListItem') {
			// Empty list-marker rows can prefix a genuine CodeBlock. Only CodeText owns code;
			// container markers and leading empty rows must not gain code decorations.
			const content=node.node.getChildren('CodeText').find(text=>/\S/u.test(source.slice(text.from,text.to)));
			if(!content)return false;
			contentFrom=content.from+source.slice(content.from,content.to).search(/\S/u);
		}
		const info=node.node.getChild('CodeInfo');
		const language=info ? source.slice(info.from,info.to).trim().split(/\s/u)[0]! : '';
		if(isRenderedCodeLanguage(language))return false;
		const marks=node.node.getChildren('CodeMark');
		const opening=state.doc.lineAt(contentFrom);
		const closing=marks.length>1 ? state.doc.lineAt(marks[marks.length-1]!.from) : null;
		const last=closing ? closing.number-1 : state.doc.lineAt(node.to).number;
		const first=opening.number+(fenced ? 1 : 0);
		const content = node.node.getChildren('CodeText');
		let listDepth = 0, listTask = false, listOrderedTask = false;
		for (let ancestor = node.node.parent; ancestor; ancestor = ancestor.parent) if (ancestor.name === 'ListItem') {
			if (!listDepth) {
				listTask = /^(?:[-+*]|\d+[.)])[ \t]+\[[ xX]\]/u.test(source.slice(ancestor.from));
				listOrderedTask = /^\d+[.)][ \t]+\[[ xX]\]/u.test(source.slice(ancestor.from));
			}
			listDepth++;
		}
		const lines: CodeBlock['lines']=[];
		for(let lineNumber=first;lineNumber<=last;lineNumber++) {
			const line=state.doc.line(lineNumber);
			const text = content.find(text => text.from <= line.to && text.to > line.from);
			lines.push({from:line.from,to:line.to,number:lineNumber-first+1,
				...(!fenced || listDepth ? {contentFrom: text ? Math.max(line.from, text.from) : line.to} : {})});
		}
		blocks.push({from:opening.from,to:node.to,closed:closing!==null,indented:!fenced,barAt:closing?.from ?? node.to,lines,
			...(!fenced || listDepth ? {listDepth, listTask, ...(listOrderedTask ? {listOrderedTask} : {})} : {})});
		return false;
	}});
	discovered.set(state.doc, blocks);
	return blocks;
}
