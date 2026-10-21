import {EditorSelection, EditorState, Facet, Prec, StateEffect, StateField, Transaction, type Extension, type Text, type TransactionSpec} from '@codemirror/state';
import {Decoration, EditorView, ViewPlugin, WidgetType, getDrawSelectionConfig} from '@codemirror/view';
import {invertedEffects, isolateHistory} from '@codemirror/commands';
import {compositionStateField, selectionModeAnnotation} from './input-state';
import { codeBlocksIn } from '../code-blocks/source-scan';
import {codeDraft} from '../code-blocks/draft-state';
import {discoverSetextHeadings} from '../paragraph/setext';
import {createBlankPointerExtension} from './blank-pointer.js';
import {getParagraphProjectionState} from '../paragraph/projection';
import {normalizeParagraphSelectionEndpoint} from '../paragraph/selection-protection';
import {paragraphBoundaryTag} from '../paragraph/model';
import {quoteContainers,calloutTitleBlock} from '../callout/presentation-model';

export interface VirtualTail {
	readonly side?: 'before'|'after';
	readonly returnTo: number;
	readonly goalColumn?: number;
}
export const setVirtualTail = StateEffect.define<VirtualTail|null>({map:(value,changes)=>value&&({...value,returnTo:changes.mapPos(value.returnTo,-1)})});
export const setEdgePointer = StateEffect.define<'before'|'after'|null>();
const edgePointer = StateField.define<'before'|'after'|null>({create:()=>null,update(value,tr){
	const effect=tr.effects.find(effect=>effect.is(setEdgePointer));
	return effect?effect.value:tr.docChanged?null:value;
}});
const restoreVirtualTail=StateEffect.define<{tail:VirtualTail|null;anchor:number}>({map:(value,changes)=>{
	// Removing a cancelled provisional row also removes its empty history event.
	if(changes.touchesRange(value.anchor,value.anchor+1))return undefined;
	return {tail:value.tail&&({...value.tail,returnTo:changes.mapPos(value.tail.returnTo,-1)}),anchor:changes.mapPos(value.anchor,-1)};
}});
export const virtualTailState = StateField.define<VirtualTail|null>({
	create:()=>null,
	update(value,tr) {
		const effect=tr.effects.filter(effect=>effect.is(setVirtualTail)).at(-1);
		if(effect)return tr.state.readOnly?null:effect.value;
		const replay=tr.effects.find(effect=>effect.is(restoreVirtualTail));
		if(replay)return tr.state.readOnly?null:replay.value.tail;
		if(value&&!tr.docChanged&&tr.isUserEvent('select.pointer')&&!tr.newSelection.main.empty&&
			tr.newSelection.main.head===edgePosition(tr.state,value))return value;
		if(tr.docChanged||tr.selection&&!tr.newSelection.eq(tr.startState.selection))return null;
		return value;
	},
});
/** An edge range paints its head here, but retains ordinary source replacement semantics. */
export function isVirtualEdgeActive(state:EditorState):boolean {return !!state.field(virtualTailState,false);}
export function isVirtualTailActive(state:EditorState):boolean {return state.selection.main.empty&&isVirtualEdgeActive(state);}

/** Only root separator rows belong to the tail; block-internal blanks remain source. */
export function documentContentEnd(state:EditorState):number {
	if(codeBlocksIn(state.doc).some(block=>!block.indented&&!block.closed&&block.to===state.doc.length)&&!state.facet(codeDraft)?.typed)return state.doc.length;
	return state.doc.length-(state.sliceDoc().match(/\n[ \t\n]*$/u)?.[0].length??0);
}

export function documentContentStart(state:EditorState):number {return state.sliceDoc().match(/^[ \t]*\n(?:[ \t]*\n)*/u)?.[0].length??0;}
function firstBlankRowLength(doc:Text):number {return /^[ \t]*$/u.test(doc.line(1).text)&&doc.lines>1?doc.line(1).to+1:0;}
function edgePosition(state:EditorState,tail:VirtualTail):number {return tail.side==='before'?0:state.doc.length;}

function materializeTail(state:EditorState,text:string):TransactionSpec {
	if(state.field(virtualTailState)?.side==='before')return {changes:{from:0,to:firstBlankRowLength(state.doc),insert:text+'\n\n'},selection:{anchor:text.length},effects:setVirtualTail.of(null)};
	const from=documentContentEnd(state),prefix=from?'\n\n':'';
	return {changes:{from,to:state.doc.length,insert:prefix+text+'\n\n'},selection:{anchor:from+prefix.length+text.length},effects:setVirtualTail.of(null)};
}

/** The selection remains a legal source position; the effect owns its distinct visual meaning. */
export function enterVirtualTail(state:EditorState,options:Partial<VirtualTail>&{anchor?:number}={}):TransactionSpec {
	const side=options.side??'after',projection=getParagraphProjectionState(state);
	const real=projection?.rangeIndex.editableAnchors.filter(at=>side==='before'?at<documentContentStart(state):at>documentContentEnd(state)&&at<state.doc.length);
	const position=real?.length?(side==='before'?real[0]!:real.at(-1)!):side==='before'?0:state.doc.length;
	const selection=options.anchor===undefined?EditorSelection.create([EditorSelection.cursor(position,side==='before'?-1:1,undefined,options.goalColumn)]):EditorSelection.single(options.anchor,position);
	if(real?.length)return {selection,effects:setVirtualTail.of(null),annotations:selectionModeAnnotation.of('normal'),userEvent:'move.line',scrollIntoView:true};
	return {selection,
		effects:setVirtualTail.of({side,returnTo:options.returnTo??state.selection.main.head,goalColumn:options.goalColumn}),
		annotations:selectionModeAnnotation.of('normal'),userEvent:'move.line',scrollIntoView:true};
}

const activeOwners=Facet.define<(view:EditorView)=>boolean>();
function enabled(view:EditorView):boolean {return !view.state.readOnly&&view.state.facet(activeOwners).some(owner=>owner(view));}

class TailWidget extends WidgetType {
	constructor(readonly active:boolean,readonly blinkRate:number,readonly side:'before'|'after',readonly tag:string){super();}
	eq(other:TailWidget):boolean{return this.active===other.active&&this.blinkRate===other.blinkRate&&this.side===other.side&&this.tag===other.tag;}
	toDOM(view:EditorView):HTMLElement {
		const row=view.dom.ownerDocument.createElement('div');row.className=this.side==='after'?'paraflow-virtual-tail':'paraflow-virtual-head';
		row.classList.toggle('paraflow-virtual-edge-inactive',!this.active);
		if(this.side==='before'&&!this.active)return row;
		const gap=view.dom.ownerDocument.createElement('div');gap.className='paraflow-block-boundary-gap';gap.dataset.paraflowBefore=this.side==='after'?this.tag:'p';gap.dataset.paraflowAfter=this.side==='after'?'p':this.tag;
		if(this.side==='after')row.append(gap);
		const body=view.dom.ownerDocument.createElement('div');body.className='paraflow-virtual-edge-body';row.append(body);
		row.setAttribute('aria-hidden','true');
		if(this.active){const caret=view.dom.ownerDocument.createElement('span');caret.className='paraflow-virtual-tail-caret';caret.textContent='\u200b';
			const blink=this.blinkRate;
			caret.style.animationDuration=`${blink}ms`;caret.classList.toggle('paraflow-virtual-tail-caret-static',blink<=0);body.append(caret);}
		if(this.side==='before')row.append(gap);
		return row;
	}
	ignoreEvent():boolean{return false;}
}
const activateTail=StateEffect.define<boolean>();
const tailEnabled=StateField.define({create:()=>false,update:(value,tr)=>tr.effects.find(effect=>effect.is(activateTail))?.value??value});
const endpointSelection=EditorState.transactionExtender.of(tr=>{
	const history=tr.isUserEvent('undo')||tr.isUserEvent('redo');
	if(tr.docChanged&&!history||tr.isUserEvent('input')||tr.state.readOnly||tr.effects.some(effect=>effect.is(setVirtualTail)))return null;
	const activated=tr.effects.find(effect=>effect.is(activateTail))?.value;
	if(!(activated??tr.startState.field(tailEnabled))||!tr.selection&&!activated)return null;
	const selection=tr.newSelection;
	if(selection.ranges.length!==1)return null;
	if(!selection.main.empty&&selection.main.head===0&&documentContentStart(tr.state)>0)
		return {effects:setVirtualTail.of({side:'before',returnTo:tr.startState.selection.main.head})};
	if(selection.main.head!==tr.newDoc.length)return null;
	const end=documentContentEnd(tr.state);
	if(end===tr.newDoc.length)return null;
	// Source history carries a source caret, so LP must reclaim its replaced EOF destination.
	return {effects:setVirtualTail.of({side:'after',returnTo:Math.min(tr.startState.selection.main.head,end)})};
});
const tailDecoration=StateField.define({
	create:()=>Decoration.none,
	update(_value,tr){
		if(!tr.state.field(tailEnabled)||!tr.newDoc.length)return Decoration.none;
		const end=tr.newDoc.length,contentEnd=documentContentEnd(tr.state),start=documentContentStart(tr.state),edge=tr.state.field(virtualTailState);
		const blocks=getParagraphProjectionState(tr.state)?.authority.blocks;
		const codes=codeBlocksIn(tr.newDoc),beforeTag=codes.some(block=>block.from===start)?'code-block':paragraphBoundaryTag(blocks?.[0]),afterTag=codes.some(block=>block.to===contentEnd)?'code-block':paragraphBoundaryTag(blocks?.at(-1));
		const head=tr.state.selection.main.head,editingBlank=!isVirtualTailActive(tr.state)&&head>contentEnd&&head<end;
		const ranges=contentEnd<end&&!editingBlank?[Decoration.replace({block:true,inclusiveStart:false,inclusiveEnd:false}).range(contentEnd,end)]:[];
		if(edge?.side==='before'&&start)ranges.push(Decoration.replace({block:true,inclusiveStart:false,inclusiveEnd:false}).range(0,start));
		// Block endings at EOF use side 1; the outside paragraph follows those surfaces.
		ranges.push(Decoration.widget({widget:new TailWidget(!!edge&&edge.side!=='before',getDrawSelectionConfig(tr.state).cursorBlinkRate!,'after',afterTag),block:true,side:2}).range(end));
		ranges.push(Decoration.widget({widget:new TailWidget(edge?.side==='before',getDrawSelectionConfig(tr.state).cursorBlinkRate!,'before',beforeTag),block:true,side:-2}).range(0));
		return Decoration.set(ranges,true);
	},
	provide:field=>EditorView.decorations.from(field),
});

const tailInput=Prec.highest(EditorState.transactionFilter.of(tr=>{
	const tail=tr.startState.field(virtualTailState,false);
	if(!tail||!tr.startState.selection.main.empty||tr.startState.readOnly||!tr.docChanged||!tr.isUserEvent('input')||tr.isUserEvent('input.virtual-tail')||tr.effects.some(effect=>effect.is(setVirtualTail)))return tr;
	let inserted:string|null=null,count=0;
	tr.changes.iterChanges((from,to,_fromB,_toB,text)=>{count++;if(from===edgePosition(tr.startState,tail)&&to===from)inserted=text.toString();});
	if(count!==1||!inserted)return tr;
	// Replace the original insertion, including only separators owned by this root destination.
	return {...materializeTail(tr.startState,inserted),userEvent:tr.annotation(Transaction.userEvent),annotations:isolateHistory.of('before')};
}));
const edgePointerSelection=Prec.highest(EditorState.transactionFilter.of(tr=>{
	const side=tr.startState.field(edgePointer);
	if(!side||tr.docChanged||!tr.selection||!tr.isUserEvent('select.pointer')||tr.newSelection.ranges.length!==1)return tr;
	const head=side==='before'?0:tr.newDoc.length;
	return [tr,{selection:EditorSelection.single(tr.newSelection.main.anchor,head),effects:setVirtualTail.of({side,returnTo:tr.startState.field(virtualTailState)?.returnTo??tr.startState.selection.main.head}),sequential:true}];
}));
const prepareTailComposition=StateEffect.define<boolean>();
const tailCompositionPrepared=StateField.define({create:()=>false,update:(value,tr)=>tr.effects.find(effect=>effect.is(prepareTailComposition))?.value??(tr.docChanged?false:value)});
const nativeTailInput=Prec.highest(EditorView.inputHandler.of((view,_from,_to,text,insert)=>{
	if(view.state.field(tailCompositionPrepared)) {
		// Consume CM's first-composition bookkeeping before correcting the caret.
		const native=insert();
		view.dispatch({changes:native.changes,selection:{anchor:_from+text.length},effects:[...native.effects,prepareTailComposition.of(false)],userEvent:'input.type.compose',scrollIntoView:native.scrollIntoView});
		if(!view.compositionStarted)commitCompositionHead(view);
		return true;
	}
	const tail=view.state.field(virtualTailState);
	if(!tail||!view.state.selection.main.empty||!enabled(view))return false;
	if(!text)return true;
	const native=insert();
	view.dispatch({...materializeTail(view.state,text),
		userEvent:native.annotation(Transaction.userEvent)??'input.type',annotations:isolateHistory.of('before'),scrollIntoView:true});
	return true;
}));
const compositionTails=new WeakMap<EditorView,{doc:Text;tail:VirtualTail;appendOnly:boolean}>();
function commitCompositionHead(view:EditorView):void {
	const session=compositionTails.get(view);
	if(session?.tail.side!=='before')return;
	compositionTails.delete(view);
	const prefix=firstBlankRowLength(session.doc);
	if(prefix<=1)return;
	const inserted=view.state.doc.length-session.doc.length;
	// The deferred native commit may already have been undone.
	if(inserted<1||view.state.sliceDoc(inserted)!==session.doc.toString())return;
	const from=inserted+prefix-1;
	view.dispatch({changes:{from:from-(prefix-1),to:from},userEvent:'input.type.compose'});
}
function prepareCompositionTail(view:EditorView):void {
	const tail=view.state.field(virtualTailState);
	if(!tail||!view.state.selection.main.empty||!enabled(view))return;
	const before=tail.side==='before';
	const from=before?0:documentContentEnd(view.state),suffix=before?view.state.sliceDoc(0,documentContentStart(view.state)):view.state.sliceDoc(from),appendOnly=!before&&/^\n*$/u.test(suffix)&&suffix.length<=(from?4:2);
	compositionTails.set(view,{doc:view.state.doc,tail,appendOnly});
	const prepared=before?{changes:{from:0,insert:firstBlankRowLength(view.state.doc)?'\n':'\n\n'},selection:{anchor:0}}:appendOnly?{changes:{from:view.state.doc.length,insert:'\n'.repeat((from?4:2)-suffix.length)},selection:{anchor:from+(from?2:0)}}:materializeTail(view.state,'');
	view.dispatch({...prepared,effects:[setVirtualTail.of(null),prepareTailComposition.of(true)],
		userEvent:'input.type.compose',annotations:isolateHistory.of('before'),scrollIntoView:true});
}
const compositionTailInput=Prec.highest(EditorView.domEventHandlers({compositionstart(_event,view){
	prepareCompositionTail(view);
	return false;
},compositionend(event,view){
	if(event.data&&compositionTails.get(view)?.tail.side==='before'){
		const session=compositionTails.get(view);
		// Native compositionend precedes the final DOM input mutation.
		view.dom.ownerDocument.defaultView!.setTimeout(()=>{if(view.plugin(tailView)&&compositionTails.get(view)===session)commitCompositionHead(view);},0);
		return false;
	}
	const session=compositionTails.get(view);compositionTails.delete(view);
	if(session&&!event.data)queueMicrotask(()=>{
		if(!view.plugin(tailView)||view.compositionStarted)return;
		const {doc,tail,appendOnly}=session;
		if(tail.side==='before'){
			const count=firstBlankRowLength(doc)?1:2;
			if(view.state.doc.toString()!=='\n'.repeat(count)+doc.toString())return;
			view.dispatch({changes:{from:0,to:count},selection:{anchor:0},effects:[setVirtualTail.of(tail),prepareTailComposition.of(false)],annotations:Transaction.addToHistory.of(false)});return;
		}
		const from=doc.length-(doc.toString().match(/\n[ \t\n]*$/u)?.[0].length??0),expected=doc.sliceString(0,from)+(from?'\n\n':'')+'\n\n';
		if(view.state.doc.toString()!==expected)return;
		view.dispatch({changes:appendOnly?{from:doc.length,to:view.state.doc.length}:{from,to:view.state.doc.length,insert:doc.sliceString(from)},selection:{anchor:doc.length},effects:[setVirtualTail.of(tail),prepareTailComposition.of(false)],annotations:Transaction.addToHistory.of(false)});
	});
	return false;
}}));

const tailHistory=invertedEffects.of(tr=>{
	if(!tr.docChanged)return [];
	const before=tr.startState.field(virtualTailState,false)??null,after=tr.state.field(virtualTailState,false)??null;
	return before||after?[restoreVirtualTail.of({tail:before,anchor:before?.side==='before'?0:tr.startState.doc.length})]:[];
});

const tailView=ViewPlugin.define(view=>{
	let destroyed=false;
	let pending=false;
	const refresh=()=>{if(pending||view.state.field(tailEnabled)===enabled(view))return;pending=true;queueMicrotask(()=>{pending=false;if(!destroyed)view.dispatch({effects:activateTail.of(enabled(view)),annotations:Transaction.addToHistory.of(false)});});};
	refresh();
	const leave=(extend:boolean)=>{const tail=view.state.field(virtualTailState)!;view.dispatch({selection:extend?{anchor:view.state.selection.main.anchor,head:tail.returnTo}:{anchor:tail.returnTo},effects:setVirtualTail.of(null),userEvent:'move.line',scrollIntoView:true});};
	const capture=(event:KeyboardEvent)=>{
		if(event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey||event.isComposing||view.composing||view.state.field(compositionStateField,false)||!enabled(view)||
			(event.target as Element).closest('.cm-content,[contenteditable="true"]')!==view.contentDOM)return;
		const selection=view.state.selection;
		if(selection.ranges.length!==1||!selection.main.empty&&!event.shiftKey)return;
		if(event.shiftKey&&!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
		if(isVirtualEdgeActive(view.state)) {
			// Windows acquires its DOM range before compositionstart; Process precedes it.
			if(event.key==='Process'){prepareCompositionTail(view);return;}
			const before=view.state.field(virtualTailState)!.side==='before';
			if((before?['ArrowRight','ArrowDown','Delete','End']:['ArrowLeft','ArrowUp','Backspace','Home']).includes(event.key))leave(event.shiftKey);
			else if(event.key==='Enter') {
				view.dispatch({...materializeTail(view.state,''),userEvent:'input.virtual-tail',annotations:isolateHistory.of('full')});
			} else if(!(before?['ArrowLeft','ArrowUp','Backspace','Home']:['ArrowDown','ArrowRight','Delete','End']).includes(event.key))return;
		} else {
			if(!['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(event.key))return;
			const before=event.key==='ArrowUp'||event.key==='ArrowLeft',head=selection.main.head;
			const boundary=before?documentContentStart(view.state):documentContentEnd(view.state);
			const setext=discoverSetextHeadings(view.state).find(heading=>heading.to===boundary);
			const quote=before?quoteContainers(view.state).find(card=>card.from===boundary&&card.depth===1):undefined;
			const firstText=quote?.blocks[0]?.positions[0];
			// A later paragraph must not stand in for an initial table, code or math block.
			const quoteStart=quote?.kind==='callout'?calloutTitleBlock(view.state,quote)?.positions[0]:
				firstText!==undefined&&view.state.doc.lineAt(firstText).from===quote?.from?firstText:undefined;
			const endpoint=quoteStart??normalizeParagraphSelectionEndpoint(view.state,before?boundary:(setext?.contentTo??boundary),before?1:-1);
			if(event.key==='ArrowRight'&&head<endpoint||event.key==='ArrowLeft'&&head>endpoint)return;
			if(event.key==='ArrowDown'||event.key==='ArrowUp') {
				if(before?view.state.doc.lineAt(head).number>view.state.doc.lineAt(endpoint).number:view.state.doc.lineAt(head).number<view.state.doc.lineAt(endpoint).number)return;
				const caret=view.coordsAtPos(head),edge=view.coordsAtPos(endpoint,before?1:-1);
				if(!caret||!edge||(before?caret.top>edge.top+1:caret.top<edge.top-1))return;
			}
			view.dispatch(enterVirtualTail(view.state,{side:before?'before':'after',anchor:event.shiftKey?selection.main.anchor:undefined}));
		}
		event.preventDefault();event.stopPropagation();
	};
	view.dom.addEventListener('keydown',capture,true);
	return {update(update){
		refresh();
		if(update.docChanged||update.selectionSet||update.viewportChanged||update.geometryChanged||update.transactions.some(tr=>tr.effects.length)||update.startState.field(virtualTailState)!==view.state.field(virtualTailState)||update.startState.field(tailEnabled)!==view.state.field(tailEnabled))view.requestMeasure({key:'paraflow-edge-carriers',read:()=>{
			if(destroyed)return [];
			const tail=view.state.field(virtualTailState),start=documentContentStart(view.state),end=documentContentEnd(view.state);
			const head=view.state.selection.main.head,length=view.state.doc.length;
			// An unfinished code block's empty final line remains an ordinary source destination.
			const internalEmptyEnd=end===length&&view.state.doc.lineAt(length).length===0;
			const ownsEnd=view.state.field(tailEnabled)&&length>0&&!internalEmptyEnd&&!(!tail&&head>end&&head<length);
			let neighbor=false;
			return Array.from(view.contentDOM.children).map(node=>{
				const row=node as HTMLElement;
				const eligible=!row.textContent&&(row.classList.contains('cm-line')||row.classList.contains('paraflow-block-boundary-gap'));
				const at=eligible?view.posAtDOM(row):0;
				const collapse=eligible&&((tail?.side==='before'&&at<=start)||(ownsEnd&&at>=end));
				const first=tail?.side==='before'&&!neighbor&&!collapse&&!row.matches('.paraflow-virtual-head,.paraflow-virtual-tail')&&row.getBoundingClientRect().height>0;
				if(first)neighbor=true;
				return {row,collapse,first};
			});
		},write:rows=>{if(destroyed)return;for(const {row,collapse,first} of rows){
			row.classList.toggle('paraflow-edge-carrier',collapse);
			row.classList.toggle('paraflow-edge-first-block',first);
		}}});
		// Follow an explicit caret movement, not viewport updates from manual scrolling.
		if(isVirtualEdgeActive(view.state)&&(update.transactions.some(tr=>tr.scrollIntoView)||update.startState.field(virtualTailState)!==view.state.field(virtualTailState)))view.requestMeasure({key:tailView,read:()=>{
			if(destroyed)return 0;
			const row=view.contentDOM.querySelector<HTMLElement>(view.state.field(virtualTailState)?.side==='before'?'.paraflow-virtual-head':'.paraflow-virtual-tail')?.getBoundingClientRect(),scroll=view.scrollDOM.getBoundingClientRect();
			return row?row.top<scroll.top?row.top-scroll.top:Math.max(0,row.bottom-scroll.bottom):0;
		},write:delta=>{if(!destroyed)view.scrollDOM.scrollTop+=delta;}});
		if(isVirtualEdgeActive(view.state)&&!enabled(view))queueMicrotask(()=>{if(!destroyed&&isVirtualEdgeActive(view.state))view.dispatch({effects:setVirtualTail.of(null),annotations:Transaction.addToHistory.of(false)});});
	},destroy(){destroyed=true;
		for(const row of view.contentDOM.querySelectorAll<HTMLElement>('.paraflow-edge-carrier,.paraflow-edge-first-block'))row.classList.remove('paraflow-edge-carrier','paraflow-edge-first-block');
		view.dom.removeEventListener('keydown',capture,true);}};
});

const blankPointerExtension = createBlankPointerExtension(enabled);

/** One input owner and one row per editor; no nested contenteditable or out-of-document positions. */
export function createVirtualTailExtension(options:{isActive:(view:EditorView)=>boolean}):Extension {
	return [activeOwners.of(options.isActive),virtualTailState,tailEnabled,tailCompositionPrepared,edgePointer,tailDecoration,endpointSelection,tailInput,edgePointerSelection,nativeTailInput,compositionTailInput,tailHistory,tailView,blankPointerExtension,
		EditorView.editorAttributes.of(view=>({class:isVirtualEdgeActive(view.state)?'paraflow-virtual-tail-active'+(view.state.field(virtualTailState)?.side==='before'?' paraflow-virtual-head-active':''):''})),EditorView.baseTheme({
		'.cm-content > .paraflow-virtual-tail,.cm-content > .paraflow-virtual-head':{height:'auto',minHeight:'1lh',position:'relative',cursor:'text'},
		'.cm-content > .paraflow-virtual-head.paraflow-virtual-edge-inactive':{height:'0',minHeight:'0',overflow:'hidden'},
		'.paraflow-virtual-edge-body':{height:'1lh',minHeight:'1em'},
		'.paraflow-edge-first-block':{marginBlockStart:'0!important'},
		'.cm-content > .paraflow-edge-carrier, .markdown-source-view.mod-cm6.is-live-preview > &.paraflow-paragraph-editing-active .cm-content > .paraflow-edge-carrier:is(.cm-line,.paraflow-block-boundary-gap)':{height:'0!important',minHeight:'0!important',lineHeight:'0!important',paddingBlock:'0!important',border:'0!important',marginBlock:'0!important'},
		'.paraflow-virtual-tail-caret':{display:'inline',height:'auto',verticalAlign:'baseline',borderLeft:'1px solid currentColor',visibility:'hidden',animation:'steps(1) cm-blink 1.2s infinite'},
		'.paraflow-virtual-tail-caret-static':{animationName:'none'},
		'&.cm-focused.paraflow-virtual-tail-active .paraflow-virtual-tail-caret':{visibility:'visible'},
		'&.paraflow-virtual-tail-active .cm-cursor':{visibility:'hidden'},
		'&.paraflow-virtual-tail-active .cm-content':{caretColor:'transparent !important'},
	})];
}
