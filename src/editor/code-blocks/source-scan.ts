import type { Text } from '@codemirror/state';
import { parser } from '@lezer/markdown';

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
