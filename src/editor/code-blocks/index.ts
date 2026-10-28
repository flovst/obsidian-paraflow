import { createDetachedEl } from '../../dom';
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { discoverCodeBlocks, type CodeBlockOptions } from './model.js';
import { type CodeBlock } from './source-scan.js';
import { createRenderedContainerCodeBlocks } from './rendered-containers.js';
import { createCodeMarkerExtension } from './markers.js';
import { codeDraftStart } from './draft-state.js';
import { containerBlockFrame, wrapContainerBlock, type ContainerFrame } from '../callout/container-surface.js';
import { projectQuoteContent } from '../callout/projection.js';
import { listBlockInset } from '../paragraph/list-block-geometry.js';
import { createCodeKeyboardExit } from './keyboard-exit.js';
import {createNativeDecorationOwnership,nativeBlockOwnership,isNativeReplacement} from '../runtime/native-decoration-ownership.js';
import {createCodeSyntaxColors,type CodePrism} from './syntax-colors.js';
import { createCodeParserSource } from './parser-source.js';
import { createSharedMathParser } from '../math/shared-parser.js';
import { createCodeBodySelection } from './selection.js';
export { CODE_BLOCK_CSS } from './styles.js';
export type { CodeBlockOptions } from './model.js';

const offsets=new WeakMap<EditorView,Map<number,number>>();

function scrollBlock(view: EditorView, id: number, offset: number, lines?: readonly HTMLElement[]): void {
	let values=offsets.get(view);
	if(!values) {values=new Map();offsets.set(view,values);}
	values.set(id,offset);
	for(const line of lines ?? view.contentDOM.querySelectorAll<HTMLElement>(`.paraflow-code-line[data-paraflow-code-block="${id}"]`)) {
		line.scrollLeft=offset;
		// Keep the inset container frame at the viewport edge while code scrolls beneath it.
		line.style.setProperty('--paraflow-code-scroll-offset', `${line.scrollLeft}px`);
	}
}

class CodeScrollWidget extends WidgetType {
	private listeners=new WeakMap<HTMLElement,()=>void>();
	constructor(readonly id: number, readonly frame: ContainerFrame | null, readonly listDepth = 0, readonly listInset?: string) {super();}
	eq(other: CodeScrollWidget): boolean {return this.id===other.id && this.frame?.key===other.frame?.key && this.listDepth===other.listDepth && this.listInset===other.listInset;}
	toDOM(view: EditorView): HTMLElement {
		const bar=createDetachedEl(view.dom.ownerDocument, 'div');
		bar.className='paraflow-code-scroll';bar.setAttribute('data-paraflow-code-block',String(this.id));
		bar.style.setProperty('--paraflow-code-list-depth', String(this.listDepth));
		if(this.listInset)bar.style.setProperty('--paraflow-code-list-inset',this.listInset);
		bar.hidden=true;
		bar.setAttribute('aria-label','横向滚动代码');bar.setAttribute('role','region');bar.tabIndex=0;
		const track=createDetachedEl(view.dom.ownerDocument, 'div');track.className='paraflow-code-scroll-track';bar.append(track);
		const scroll=()=>scrollBlock(view,this.id,bar.scrollLeft);
		bar.addEventListener('scroll',scroll);
		const dom=wrapContainerBlock(view,bar,this.frame);dom.hidden=true;
		if(dom!==bar)dom.classList.add('paraflow-code-scroll-container');
		this.listeners.set(dom,()=>bar.removeEventListener('scroll',scroll));
		return dom;
	}
	destroy(dom: HTMLElement): void {
		this.listeners.get(dom)?.();
		this.listeners.delete(dom);
	}
	ignoreEvent(): boolean {return true;}
}

class CodeExtentWidget extends WidgetType {
	eq(): boolean {return true;}
	toDOM(view: EditorView): HTMLElement {
		const extent=createDetachedEl(view.dom.ownerDocument, 'span');
		extent.className='paraflow-code-extent';extent.setAttribute('aria-hidden','true');
		return extent;
	}
	ignoreEvent(): boolean {return true;}
}

function decorate(state: EditorState, blocks: CodeBlock[], options: CodeBlockOptions): DecorationSet {
	const ranges: Range<Decoration>[]=[];
	for(const block of blocks) {
		if(block.from===state.facet(codeDraftStart))continue;
		const frame = containerBlockFrame(state,block.from,state.doc.lineAt(block.from).to);
		const fencedList = !block.indented && !!block.listDepth;
		const listInset = fencedList ? listBlockInset(Math.max(0,block.listDepth!-(frame?.rails.cards.at(-1)?.listDepth ?? 0)),block.listTask,block.listOrderedTask) : undefined;
		for(const line of block.lines) {
			const attributes: Record<string,string>={'data-paraflow-code-block':String(block.from)};
			const style: string[] = [];
			if (block.indented) style.push(`--paraflow-code-list-depth:${block.listDepth ?? 0}`);
			if(listInset)style.push(`--paraflow-code-list-inset:${listInset}`);
			if(options.codeLineNumbers) {
				attributes['data-paraflow-line']=String(line.number);
				style.push(`--paraflow-code-number-digits:${String(block.lines.length).length}`);
			}
			attributes.style = style.join(';');
			ranges.push(Decoration.line({class:'paraflow-code-line'+(block.indented ? ' paraflow-code-indented' +
				(line.number === 1 ? ' paraflow-code-start' : '') + (line.number === block.lines.length ? ' paraflow-code-end' : '') : '')+
				(fencedList ? ' paraflow-code-fenced-list' : '')+(options.codeWordWrap ? ' paraflow-code-wrap' : ''),attributes}).range(line.from));
			const lineFrame = containerBlockFrame(state, line.from, line.to);
			const prefixFrom = lineFrame ? projectQuoteContent(state, line.from, line.to, lineFrame.rails.cards.at(-1)!.depth)!.toSource(0) : line.from;
			if (line.contentFrom !== undefined && prefixFrom < line.contentFrom) ranges.push(Decoration.replace({}).range(prefixFrom, line.contentFrom));
			if(!options.codeWordWrap && line.to>(line.contentFrom??prefixFrom))ranges.push(Decoration.widget({widget:new CodeExtentWidget(),side:1}).range(line.to));
		}
		if(!options.codeWordWrap && block.lines.length)ranges.push(Decoration.widget({widget:new CodeScrollWidget(block.from,frame,block.listDepth,listInset),block:true,side:block.closed ? -1 : 1}).range(block.barAt));
	}
	return Decoration.set(ranges,true);
}

interface BlockMeasure {id:number; lines:HTMLElement[]; width:number; offset:number; overflowing:boolean; extents:Array<{element:HTMLElement; width:number}>; frameBorders:Array<{element:HTMLElement; left:string; right:string}>; bar:HTMLElement | null}

function codeLineAt(block: CodeBlock, position: number): CodeBlock['lines'][number] | undefined {
	let low=0,high=block.lines.length;
	while(low<high) {const middle=(low+high)>>>1;if(block.lines[middle]!.from<=position)low=middle+1;else high=middle;}
	const line=block.lines[low-1];
	return line && position<=line.to ? line : undefined;
}

function hasCodeCaret(blocks: readonly CodeBlock[], position: number): boolean {
	let low=0,high=blocks.length;
	while(low<high) {const middle=(low+high)>>>1;if(blocks[middle]!.from<=position)low=middle+1;else high=middle;}
	const block=blocks[low-1];
	return !!block && !!codeLineAt(block,position);
}

export function createCodeBlockExtension(config: {
	isActive: (view: EditorView)=>boolean;
	getOptions: ()=>CodeBlockOptions;
	loadPrism?: ()=>Promise<CodePrism>;
}): Extension {
	const activate=StateEffect.define<boolean>();
	const field=StateField.define({
		create(state) {
			const blocks=discoverCodeBlocks(state);
			return {active:false,blocks,byId:new Map(blocks.map(block=>[block.from,block])),options:{...config.getOptions()},decorations:Decoration.none};
		},
		update(value,tr) {
			const active=tr.effects.find(effect=>effect.is(activate))?.value ?? value.active;
			const options=config.getOptions();
			const syntaxChanged=syntaxTree(tr.startState)!==syntaxTree(tr.state);
			if(!tr.docChanged && !syntaxChanged && tr.state.facet(codeDraftStart)===tr.startState.facet(codeDraftStart) && active===value.active && options.codeLineNumbers===value.options.codeLineNumbers && options.codeWordWrap===value.options.codeWordWrap)return value;
			const blocks=tr.docChanged || syntaxChanged ? discoverCodeBlocks(tr.state) : value.blocks;
			return {active,blocks,byId:blocks===value.blocks ? value.byId : new Map(blocks.map(block=>[block.from,block])),options:{...options},decorations:active ? decorate(tr.state,blocks,options) : Decoration.none};
		},
		provide: value=>EditorView.decorations.from(value,state=>state.decorations),
	});
	return [createSharedMathParser(), createCodeParserSource(), config.loadPrism ? createCodeSyntaxColors({...config,loadPrism:config.loadPrism}) : [],createNativeDecorationOwnership(),nativeBlockOwnership.of((state,view)=>{
		if(!config.isActive(view))return null;
		const blocks=discoverCodeBlocks(state).filter(block=>!block.indented&&block.from!==state.facet(codeDraftStart));
		const openings=new Set(blocks.map(block=>state.doc.lineAt(block.from).to));
		const virtualOpenings=blocks.filter(block=>!block.lines.length).map(block=>state.doc.lineAt(block.from));
		return (from,to,decoration)=>{
			const widget=(decoration.spec as {widget?:{toDOM:(view:EditorView)=>HTMLElement}}).widget;
			// The native empty replacement otherwise hides the caret's font-metric glyph.
			if(!widget&&isNativeReplacement(decoration)&&virtualOpenings.some(line=>line.from===from&&line.to===to))return true;
			return from===to&&openings.has(from)&&!!widget&&Function.prototype.toString.call(widget.toDOM).includes('code-block-flair');
		};
	}),createCodeBodySelection(config.isActive),createCodeKeyboardExit(config.isActive),createCodeMarkerExtension(config.isActive,config.getOptions),field,ViewPlugin.fromClass(class {
		private destroyed=false;
		private activationPending=false;
		private naturalWidths=new Map<number,{width:number; typography:string}>();
		private rendered: ReturnType<typeof createRenderedContainerCodeBlocks>;
		private contextDocument: Document | null=null;
		private contextAncestors: Element[]=[];
		private contextObserver: MutationObserver | null=null;
		private contextChanged=():void=>this.schedule();
		private fontsChanged=():void=>{this.naturalWidths.clear();this.schedule();};
		constructor(readonly view: EditorView) {
			this.rendered=createRenderedContainerCodeBlocks(view.contentDOM,{isActive:()=>config.isActive(view),getOptions:config.getOptions});
			this.bindContext();
			this.syncActivation();
		}
		update(update: ViewUpdate): void {
			if(update.docChanged) {offsets.delete(this.view);this.naturalWidths.clear();}
			if(update.startState.field(field).options.codeLineNumbers!==update.state.field(field).options.codeLineNumbers)this.naturalWidths.clear();
			this.rendered.refresh();
			this.bindContext();
			this.syncActivation();
			const before=update.startState.field(field),after=update.state.field(field);
			const movedHead=update.startState.selection.main.head!==update.state.selection.main.head;
			if(before!==after || update.viewportChanged || update.geometryChanged || update.focusChanged || update.transactions.some(tr=>tr.reconfigured) ||
				(movedHead && after.active && !after.options.codeWordWrap && this.view.hasFocus && hasCodeCaret(after.blocks,update.state.selection.main.head)))this.schedule();
		}
		private bindContext(): void {
			const owner=this.view.dom.ownerDocument,ancestors:Element[]=[];
			for(let node:Element|null=this.view.dom;node;node=node.parentElement)ancestors.push(node);
			if(owner===this.contextDocument && ancestors.length===this.contextAncestors.length && ancestors.every((node,index)=>node===this.contextAncestors[index]))return;
			this.releaseContext();this.contextDocument=owner;this.contextAncestors=ancestors;
			const win=owner.defaultView!;
			this.contextObserver=new win.MutationObserver(records=>{
				if(records.some(record=>record.type!=='attributes' || record.oldValue!==(record.target as Element).getAttribute(record.attributeName!)))this.schedule();
			});
			this.contextObserver.observe(owner.head,{childList:true,subtree:true,characterData:true,attributes:true,attributeOldValue:true});
			for(const node of ancestors)this.contextObserver.observe(node,{attributes:true,attributeFilter:['class','style'],attributeOldValue:true});
			for(const node of [this.view.contentDOM,this.view.scrollDOM])this.contextObserver.observe(node,{attributes:true,attributeFilter:['class','style'],attributeOldValue:true});
			win.addEventListener('resize',this.contextChanged);
			win.visualViewport?.addEventListener('resize',this.contextChanged);
			owner.fonts?.addEventListener('loadingdone',this.fontsChanged);
			this.schedule();
		}
		private releaseContext(): void {
			this.contextObserver?.disconnect();
			const win=this.contextDocument?.defaultView;
			win?.removeEventListener('resize',this.contextChanged);
			win?.visualViewport?.removeEventListener('resize',this.contextChanged);
			this.contextDocument?.fonts?.removeEventListener('loadingdone',this.fontsChanged);
		}
		private syncActivation(): void {
			if(!this.activationPending) {
				this.activationPending=true;
				queueMicrotask(()=>{
					this.activationPending=false;
					if(this.destroyed)return;
					const active=config.isActive(this.view);
					if(active!==this.view.state.field(field).active)this.view.dispatch({effects:activate.of(active)});
				});
			}
		}
		private schedule(): void {
			if(this.destroyed)return;
			this.view.requestMeasure({key:this,read:view=>this.measure(view),write:measurements=>{
				if(this.destroyed)return;
				let insetChanged=false;
				for(const entry of measurements) {
					for(const frame of entry.frameBorders)for(const side of ['left','right'] as const) {
						const property=`--paraflow-code-frame-border-${side}`;
						if(frame.element.style.getPropertyValue(property)!==frame[side]) {
							frame.element.style.setProperty(property,frame[side]);
							insetChanged=true;
						}
					}
					for(const extent of entry.extents)extent.element.style.width=`${extent.width}px`;
					if(entry.bar) {
						entry.bar.hidden=!entry.overflowing;
						const frame=entry.bar.closest<HTMLElement>('.paraflow-container-block');
						if(frame)frame.hidden=!entry.overflowing;
						const track=entry.bar.firstElementChild as HTMLElement;
						track.style.width=`${entry.width}px`;
						entry.bar.scrollLeft=entry.offset;
					}
					scrollBlock(this.view,entry.id,entry.offset,entry.lines);
				}
				if(insetChanged)this.schedule();
			}});
		}
		private measure(view: EditorView): BlockMeasure[] {
			// CodeMirror may flush this queued request after reconfiguration removes us.
			if(this.destroyed)return [];
			const state=view.state.field(field);
			if(!state.active)return [];
			const result: BlockMeasure[]=[];
			const mounted=new Map<number,HTMLElement[]>();
			for(const line of view.contentDOM.querySelectorAll<HTMLElement>('.paraflow-code-line[data-paraflow-code-block]')) {
				const id=Number(line.dataset.paraflowCodeBlock);
				const lines=mounted.get(id);if(lines)lines.push(line);else mounted.set(id,[line]);
			}
			const bars=new Map<number,HTMLElement>();
			if(mounted.size)for(const bar of view.contentDOM.querySelectorAll<HTMLElement>('.paraflow-code-scroll[data-paraflow-code-block]'))bars.set(Number(bar.dataset.paraflowCodeBlock),bar);
			for(const [id,mountedLines] of mounted) {
				const block=state.byId.get(id)!;
				// Hidden editors have no layout width; retain their last valid overflow geometry.
				const lines=mountedLines.filter(line=>line.clientWidth>0);
				if(!lines.length)continue;
				const bar=bars.get(id) ?? null;
				const style=view.dom.ownerDocument.defaultView!.getComputedStyle(lines[0]!);
				// Container frames are painted outside layout; reserve their actual themed borders.
				const frameBorders=lines.filter(line=>line.classList.contains('paraflow-callout-line')).map(element=>{
					const frame=view.dom.ownerDocument.defaultView!.getComputedStyle(element,'::after');
					return {element,left:frame.borderLeftWidth,right:frame.borderRightWidth};
				});
				const paddingRight=Number.parseFloat(style.paddingRight)||0;
				const borderLeft=Number.parseFloat(style.borderLeftWidth)||0;
				const extents=lines.flatMap(line=>{
					const element=line.querySelector<HTMLElement>('.paraflow-code-extent');
					// clientWidth includes padding but excludes borders; the extent's rect does not.
					return element ? [{element,natural:element.getBoundingClientRect().left-line.getBoundingClientRect().left+line.scrollLeft+paddingRight-borderLeft}] : [];
				});
				// A virtualized viewport may no longer contain the block's widest line.
				// Retain that width only while its font and horizontal spacing still apply.
				const typography=[style.fontFamily,style.fontSize,style.fontWeight,style.fontStyle,style.getPropertyValue('font-stretch'),
					style.fontVariant,style.fontFeatureSettings,style.fontVariationSettings,style.letterSpacing,
					style.wordSpacing,style.paddingLeft,style.paddingRight,style.borderLeftWidth,style.borderRightWidth,style.getPropertyValue('zoom'),
					view.scaleX,view.scaleY,view.dom.ownerDocument.defaultView!.devicePixelRatio].join(';');
				const previous=this.naturalWidths.get(block.from);
				const naturalWidth=Math.max(previous?.typography===typography ? previous.width : 0,...extents.map(extent=>extent.natural));
				if(!state.options.codeWordWrap)this.naturalWidths.set(block.from,{width:naturalWidth,typography});
				const width=Math.max(...lines.map(line=>line.clientWidth),state.options.codeWordWrap ? 0 : naturalWidth);
				const maximum=Math.max(0,...lines.map(line=>width-line.clientWidth));
				let offset=state.options.codeWordWrap ? 0 : Math.min(maximum,offsets.get(view)?.get(block.from) ?? 0);
				const head=view.state.selection.main.head;
				const current=codeLineAt(block,head);
				if(current && view.hasFocus && !state.options.codeWordWrap) {
					const line=lines.find(element=>view.posAtDOM(element)===current.from);
					const caret=view.coordsAtPos(head);
					if(line && caret) {
						const rect=line.getBoundingClientRect();
						const contentStart=view.coordsAtPos(current.from);
						const left=(contentStart?.left ?? rect.left)+line.scrollLeft;
						if(caret.left<left)offset=Math.max(0,offset+caret.left-left);
						else if(caret.right>rect.right-8)offset=Math.min(maximum,offset+caret.right-rect.right+8);
					}
				}
				result.push({id:block.from,lines:mountedLines,width,offset,overflowing:maximum>0,extents:extents.map(extent=>({element:extent.element,width:width-extent.natural})),frameBorders,bar});
			}
			return result;
		}
		destroy(): void {this.destroyed=true;this.releaseContext();this.rendered.destroy();offsets.delete(this.view);this.naturalWidths.clear();}
	})];
}
