import { Prec, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { discoverCodeBlocks } from './model.js';
import { type CodeBlock } from './source-scan.js';
import { codeDraftStart } from './draft-state.js';
import { quoteContainers } from '../callout/presentation-model.js';
import { projectQuoteContent } from '../callout/projection.js';

export interface CodePrism {
	languages: Record<string, unknown>;
	highlight: (source: string, grammar: unknown, language: string) => string;
}
interface TokenRange { from: number; to: number; classes: string }
interface CodeSource { text: string; lines: Array<{ from: number; to: number; offset: number }> }

function sourceFor(state: EditorState, block: CodeBlock): CodeSource {
	const lines: CodeSource['lines']=[];
	const containers=quoteContainers(state);
	const opening=state.doc.lineAt(block.from);
	const depth=containers.filter(container=>container.from<=opening.from && container.to>=opening.to).at(-1)?.depth;
	const openingPrefix=depth ? projectQuoteContent(state,opening.from,opening.to,depth)!.toSource(0) : opening.from;
	const indent=block.listDepth ? 0 : /^ */u.exec(state.sliceDoc(openingPrefix,opening.to))![0].length;
	let text='';
	for(const line of block.lines) {
		const depth=containers.filter(container=>container.from<=line.from && container.to>=line.to).at(-1)?.depth;
		const prefix=depth ? projectQuoteContent(state,line.from,line.to,depth)!.toSource(0) : line.from;
		let from=Math.max(line.contentFrom ?? line.from,prefix);
		for(let count=0;count<indent && state.sliceDoc(from,from+1)===' ';count++)from++;
		lines.push({from,to:line.to,offset:text.length});text+=state.sliceDoc(from,line.to)+'\n';
	}
	return {text,lines};
}

export function codeSyntaxRanges(prism: CodePrism, source: string, language: string, document: Document): TokenRange[] {
	if(!prism.languages[language])return [{from:0,to:source.length,classes:'paraflow-code-syntax paraflow-code-plain'}];
	// Prism escapes source and runs its grammar/wrap hooks; only classes and text offsets leave this inert tree.
	const parsed=new document.defaultView!.DOMParser().parseFromString(`<body>${prism.highlight(source,prism.languages[language],language)}</body>`,'text/html').body;
	// Prism.util.encode normalizes NBSP to one ordinary space; both have the same source width.
	if(parsed.textContent!==source.replace(/\u00a0/gu,' '))throw new Error('Prism highlighting changed code text; cannot map syntax decorations');
	const ranges: TokenRange[]=[];
	let offset=0;
	function visit(node: Node, nested: boolean): void {
		if(node.nodeType===3) {
			const length=node.textContent!.length;
			if(!nested && length)ranges.push({from:offset,to:offset+length,classes:'paraflow-code-syntax paraflow-code-plain'});
			offset+=length;
		}else if(node.nodeType===1) {
			const range={from:offset,to:offset,classes:`paraflow-code-syntax ${(node as Element).className}`};
			ranges.push(range);for(const child of node.childNodes)visit(child,true);range.to=offset;
		}
	}
	for(const child of parsed.childNodes)visit(child,false);
	return ranges;
}

/** Reading and LP share Prism semantics; CM retains its text and editing decorations. */
export function createCodeSyntaxColors(config: {isActive:(view:EditorView)=>boolean;loadPrism:()=>Promise<CodePrism>}): Extension {
	return Prec.highest(ViewPlugin.fromClass(class {
		decorations: DecorationSet=Decoration.none;
		private prism: CodePrism | null=null;
		private destroyed=false;
		private active=false;
		private cache=new Map<string,Map<string,TokenRange[]>>();
		constructor(readonly view: EditorView) {
			void config.loadPrism().then(prism=>{
				if(this.destroyed)return;
				this.prism=prism;this.rebuild();this.view.dispatch({});
			});
		}
		update(update: ViewUpdate): void {
			if(update.docChanged || config.isActive(this.view)!==this.active ||
				update.startState.facet(codeDraftStart)!==update.state.facet(codeDraftStart) || syntaxTree(update.startState)!==syntaxTree(update.state))this.rebuild();
		}
		private rebuild(): void {
			this.active=config.isActive(this.view);
			if(!this.prism || !this.active) {this.decorations=Decoration.none;return;}
			const state=this.view.state,ranges: Range<Decoration>[]=[],next=new Map<string,Map<string,TokenRange[]>>();
			for(const block of discoverCodeBlocks(state)) {
				if(block.indented || block.from===state.facet(codeDraftStart))continue;
				const info=/(?:`{3,}|~{3,})\s*([^\s`~]*)/u.exec(state.doc.lineAt(block.from).text)?.[1] ?? '';
				// Prism's language-* class lookup accepts complete word/hyphen identifiers.
				const language=/^[\w-]+$/u.test(info) ? info.toLowerCase() : 'none';
				const source=sourceFor(state,block);
				const tokens=next.get(language)?.get(source.text) ?? this.cache.get(language)?.get(source.text) ?? codeSyntaxRanges(this.prism,source.text,language,this.view.dom.ownerDocument);
				let entries=next.get(language);if(!entries) {entries=new Map();next.set(language,entries);}entries.set(source.text,tokens);
				for(const line of source.lines)ranges.push(Decoration.line({class:`paraflow-code-syntax-line language-${language}`}).range(state.doc.lineAt(line.from).from));
				let firstLine=0;
				for(const token of tokens) {
					while(firstLine<source.lines.length && source.lines[firstLine]!.offset+source.lines[firstLine]!.to-source.lines[firstLine]!.from<=token.from)firstLine++;
					for(let index=firstLine;index<source.lines.length && source.lines[index]!.offset<token.to;index++) {
						const line=source.lines[index]!;
						const from=Math.max(token.from,line.offset),to=Math.min(token.to,line.offset+line.to-line.from);
						if(from<to)ranges.push(Decoration.mark({class:token.classes}).range(line.from+from-line.offset,line.from+to-line.offset));
					}
				}
			}
			this.cache=next;this.decorations=Decoration.set(ranges,true);
		}
		destroy(): void {this.destroyed=true;this.cache.clear();}
	},{decorations:value=>value.decorations}));
}
