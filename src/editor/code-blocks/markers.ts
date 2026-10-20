import { EditorSelection, EditorState, Transaction, Prec, StateField, type Extension, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from '@codemirror/view';
import { codeBlockEdit, codeBlocksIn, discoverCodeBlocks, type CodeBlock } from './model.js';
import { openCodeLanguagePopup, type CodeLanguagePopup } from './language-popup.js';
import type { EnhancementSettings } from '../../enhancement-settings.js';
import { codeBodyStart, codeDraftStart, codeEditableSelection, codeMarkersActive, codeContinuationPrefix as continuationPrefix } from './editable-boundaries.js';
import { containerBlockFrame, wrapContainerBlock, type ContainerFrame } from '../callout/container-surface.js';
import { listBlockInset } from '../paragraph/list-block-geometry.js';
import { invertedEffects, isolateHistory } from '@codemirror/commands';
import { creationHistory, createCreationHistory } from '../runtime/creation-history.js';
import { compositionStateField, excludedSelectionModeForTransaction } from '../runtime/input-state.js';
import { activateCodeDraft, codeDraftState, codeDraft, codeDraftHistory, codeDraftHistoryInversion, rememberCodeDraft, virtualBodyEdit } from './draft-state.js';
import type { CodeBlockOptions } from './model.js';
import {setVirtualTail, isVirtualTailActive} from '../runtime/virtual-tail.js';
import { blockContinuationPrefix, blockLineContentFrom, planBlockBodyKey } from '../runtime/block-body.js';
import { deleteAdjacentCode } from './operations.js';

class EmptyCodeCaret extends WidgetType {
	eq():boolean{return true;}
	toDOM(view:EditorView):HTMLElement {
		const glyph=view.dom.ownerDocument.createElement('span');glyph.className='paraflow-code-caret-glyph';
		// A font glyph makes Chromium paint the adjacent native caret like a real blank BR.
		glyph.textContent='\u200b';glyph.setAttribute('aria-hidden','true');return glyph;
	}
	ignoreEvent():boolean{return false;}
}

class CodeEnding extends WidgetType {
	constructor(readonly from: number, readonly bottomControl: boolean, readonly frame: ContainerFrame | null, readonly listInset: string, readonly indented = false) { super(); }
	eq(other: CodeEnding): boolean { return this.from === other.from && this.bottomControl === other.bottomControl && this.frame?.key === other.frame?.key && this.listInset === other.listInset && this.indented === other.indented; }
	toDOM(view: EditorView): HTMLElement {
		const ending = view.dom.ownerDocument.createElement('div');
		ending.className = 'paraflow-code-ending' + (this.indented ? ' paraflow-code-ending--indented' : '');
		ending.dataset.paraflowCodeBlock = String(this.from);
		if (this.bottomControl) {
			const space = view.dom.ownerDocument.createElement('div');
			space.className = 'paraflow-code-ending-space';
			space.style.setProperty('--paraflow-code-list-inset',this.listInset);
			space.append(ending);
			return wrapContainerBlock(view, space, this.frame);
		}
		ending.style.setProperty('--paraflow-code-list-inset',this.listInset);
		return wrapContainerBlock(view, ending, this.frame);
	}
	ignoreEvent(): boolean { return false; }
}

class CodeHeading extends WidgetType {
	constructor(readonly from: number, readonly language: string, readonly position: EnhancementSettings['codeLanguagePosition'], readonly open: (view: EditorView, from: number, anchor: HTMLElement, focus: boolean) => void, readonly frame: ContainerFrame | null, readonly listInset: string, readonly indented = false) { super(); }
	eq(other: CodeHeading): boolean {
		return this.from === other.from && this.language === other.language && this.position === other.position && this.frame?.key === other.frame?.key && this.listInset === other.listInset && this.indented === other.indented;
	}
	toDOM(view: EditorView): HTMLElement {
		const heading = view.dom.ownerDocument.createElement('div');
		heading.className = 'paraflow-code-heading' + (this.indented ? ' paraflow-code-heading--indented' : '');
		heading.style.setProperty('--paraflow-code-list-inset',this.listInset);
		heading.dataset.paraflowCodeBlock = String(this.from);
		if (this.position === 'top-right') {
			const edit = heading.ownerDocument.createElement('button');
			edit.className = 'paraflow-code-edit-syntax';
			edit.type = 'button'; edit.textContent = this.language || '代码';
			edit.setAttribute('aria-label', '编辑代码块语言');
			edit.title = '编辑代码块语言';
			edit.addEventListener('click', () => this.open(view, this.from, edit, true));
			edit.addEventListener('pointerenter', () => this.open(view, this.from, edit, false));
			heading.append(edit);
		}
		return wrapContainerBlock(view, heading, this.frame);
	}
	ignoreEvent(event: Event): boolean { return (event.target as Element).closest('button') !== null; }
}

/** Source remains native CM content; only the two metadata lines are replaced. */
export function createCodeMarkerExtension(isActive: (view: EditorView) => boolean, getOptions: () => CodeBlockOptions): Extension {
	const getPosition = () => getOptions().codeLanguagePosition ?? 'bottom-right';
	const activate = activateCodeDraft;
	const liveViews = new Set<EditorView>();
	interface Presentation { active: boolean; position: EnhancementSettings['codeLanguagePosition']; draft: number | null; blocks: CodeBlock[]; decorations: ReturnType<typeof Decoration.set>; numbered: boolean; wrap: boolean }
	const field = StateField.define<Presentation>({
		create: state => ({ active: false, position: getPosition(), draft: state.facet(codeDraftStart), blocks: discoverCodeBlocks(state), decorations: Decoration.none, numbered:getOptions().codeLineNumbers,wrap:getOptions().codeWordWrap }),
		update(value, tr) {
			const active = tr.effects.find(effect => effect.is(activate))?.value ?? value.active;
			const position = getPosition();
			const syntaxChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
			const blocks = tr.docChanged || syntaxChanged ? discoverCodeBlocks(tr.state) : value.blocks;
			const draft = tr.state.facet(codeDraftStart);
			const options=getOptions();
			if (!tr.docChanged && !syntaxChanged && draft === value.draft && active === value.active && position === value.position && options.codeLineNumbers===value.numbered && options.codeWordWrap===value.wrap) return value;
			const ranges: Range<Decoration>[] = [];
			if (active) for (const block of blocks) {
				const opening = tr.state.doc.lineAt(block.from);
				if (block.from === draft) {
					ranges.push(Decoration.line({class:'paraflow-code-draft'}).range(opening.from));
					continue;
				}
				const closing = tr.state.doc.lineAt(block.barAt);
				const language = opening.text.replace(/^.*?(?:`{3,}|~{3,})\s*/u, '').trim().split(/\s/u)[0]!;
				const frame = containerBlockFrame(tr.state, opening.from, opening.to);
				const inset = listBlockInset(Math.max(0,(block.listDepth ?? 0)-(frame?.rails.cards.at(-1)?.listDepth ?? 0)),block.listTask,block.listOrderedTask);
				if (block.indented) {
					if (position === 'top-right') ranges.push(Decoration.widget({ block: true, side: -1,
						widget: new CodeHeading(block.from, '', position, open, frame, inset, true) }).range(block.from));
					if (position === 'bottom-right') ranges.push(Decoration.widget({ block: true, side: 1,
						widget: new CodeEnding(block.from, true, frame, inset, true) }).range(block.lines.at(-1)!.to));
					continue;
				}
				const heading = new CodeHeading(block.from, language, position, open, frame, inset);
				if (block.lines.length) ranges.push(Decoration.replace({block:true,widget:heading}).range(opening.from,opening.to));
				else {
					// Keep the opening line's end as a native CM caret until the first body edit.
					ranges.push(Decoration.widget({block:true,side:-1,widget:heading}).range(opening.from));
					ranges.push(Decoration.replace({widget:new EmptyCodeCaret()}).range(opening.from,opening.to));
					ranges.push(Decoration.line({class:'paraflow-code-line paraflow-code-virtual'+(options.codeWordWrap?' paraflow-code-wrap':'')+(block.listDepth?' paraflow-code-fenced-list':''),attributes:{
						'data-paraflow-code-block':String(block.from),...(options.codeLineNumbers?{'data-paraflow-line':'1'}:{}),style:`--paraflow-code-list-inset:${inset}`,
					}}).range(opening.from));
				}
				if (block.closed) ranges.push(Decoration.replace({ block: true, widget: new CodeEnding(block.from, position === 'bottom-right', containerBlockFrame(tr.state, closing.from, closing.to), inset) }).range(closing.from, closing.to));
				else ranges.push(Decoration.widget({block:true,side:1,widget:new CodeEnding(block.from,position==='bottom-right',containerBlockFrame(tr.state,closing.from,closing.to),inset)}).range(block.to));
			}
			return { active, position, draft, blocks, decorations: Decoration.set(ranges, true),numbered:options.codeLineNumbers,wrap:options.codeWordWrap };
		},
		provide: value => [EditorView.decorations.from(value, state => state.decorations),codeMarkersActive.from(value,state=>state.active)],
	});
	function protectsMarker(view: EditorView, backward: boolean): boolean {
		const value = view.state.field(field), selection = view.state.selection;
		if (!value.active || view.state.readOnly || view.composing || view.state.field(compositionStateField,false) || selection.ranges.length !== 1 || !selection.main.empty) return false;
		const empty=value.blocks.find(block=>{
			if(block.indented||value.draft===block.from)return false;
			if(!block.lines.length)return selection.main.head===view.state.doc.lineAt(block.from).to;
			if(!block.closed||selection.main.head<block.lines[0]!.from||selection.main.head>block.lines[0]!.to)return false;
			const opening=view.state.doc.lineAt(block.from),prefix=opening.text.slice(0,opening.text.search(/`{3,}|~{3,}/u));
			return block.lines.every(line=>/^[ \t]*$/u.test(view.state.sliceDoc(line.contentFrom??line.from+prefix.length,line.to)));
		});
		if(backward&&empty){
			const opening=view.state.doc.lineAt(empty.from),prefix=opening.text.slice(0,opening.text.search(/`{3,}|~{3,}/u));
			view.dispatch({changes:{from:empty.from,to:empty.to,insert:prefix},selection:{anchor:empty.from+prefix.length},userEvent:'delete.code-block',annotations:isolateHistory.of('full')});view.focus();return true;
		}
		// Removing this newline would silently turn body text into metadata (or vice versa).
		return value.blocks.some(block => !block.indented && block.lines.length > 0 &&
			(backward ? selection.main.head === codeBodyStart(view.state, block) : block.closed && selection.main.head === block.lines.at(-1)!.to));
	}
	function createCode(view:EditorView):boolean {
		if(!isActive(view)||view.state.readOnly||view.composing||view.state.field(compositionStateField,false)||!view.state.selection.main.empty||view.state.selection.ranges.length!==1)return false;
		const head=view.state.selection.main.head,line=view.state.doc.lineAt(head);
		const match=/(`{3,}|~{3,})([^`~]*)$/u.exec(line.text);
		if(!match||head!==line.to)return false;
		const block=discoverCodeBlocks(view.state).find(block=>block.from===line.from&&!block.indented);
		if(!block||(block.lines.length && view.state.facet(codeDraftStart)!==block.from))return false;
		const prefix=continuationPrefix(view.state,block),insert=block.closed?`\n${prefix}`:`\n${prefix}\n${prefix}${match[1]}`;
		view.dispatch({changes:{from:line.to,insert},selection:{anchor:line.to+1+prefix.length},
			effects:[creationHistory.of({owner:'code',from:line.from,draftOffset:line.length,bodyOffset:line.length+1+prefix.length,created:true}),...(view.state.facet(codeDraft)?[codeDraftHistory.of({...view.state.facet(codeDraft)!,created:true})]:[])],
			userEvent:'input.code-create',annotations:isolateHistory.of('full')});view.focus();return true;
	}
	function enterVirtualBody(view: EditorView): boolean {
		const state = view.state, selection = state.selection;
		if (!isActive(view) || !state.field(field).active || state.readOnly || view.composing || state.field(compositionStateField, false) || selection.ranges.length !== 1 || !selection.main.empty) return false;
		const block = state.field(field).blocks.find(block => !block.indented && !block.lines.length && block.from !== state.facet(codeDraftStart) && state.doc.lineAt(block.from).to === selection.main.head);
		if (!block) return false;
		const opening = state.doc.lineAt(block.from), prefix = continuationPrefix(state, block);
		// The displayed empty row already exists conceptually; Enter adds another body row.
		const insert = `\n${prefix}\n${prefix}`, head = opening.to + insert.length;
		view.dispatch({changes: {from: opening.to, insert}, selection: {anchor: head}, userEvent: 'input.code-body',
			effects: [virtualBodyEdit.of(null), creationHistory.of({owner: 'code', from: block.from, draftOffset: opening.length, bodyOffset: head - block.from, created: true})],
			annotations: isolateHistory.of('full'), scrollIntoView: true});
		return true;
	}
	function editBody(view: EditorView, key: 'Enter' | 'Backspace' | 'Delete'): boolean {
		const state = view.state, selection = state.selection;
		if (!isActive(view) || !state.field(field).active || state.readOnly || view.composing || state.field(compositionStateField, false) || selection.ranges.length !== 1 || !selection.main.empty) return false;
		const block = state.field(field).blocks.find(block => !block.indented && block.from !== state.facet(codeDraftStart) && block.lines.some(line => line.from <= selection.main.head && selection.main.head <= line.to));
		if (!block) return false;
		const opening = state.doc.lineAt(block.from), fenceFrom = opening.from + opening.text.search(/`{3,}|~{3,}/u);
		const prefix = blockContinuationPrefix(state, fenceFrom);
		const lines = block.lines.map(line => ({ from: blockLineContentFrom(state, state.doc.lineAt(line.from).number, prefix), to: line.to }));
		const plan = planBlockBodyKey(state, key, lines, prefix);
		if (!plan) return false;
		view.dispatch(plan); return true;
	}
	function open(view: EditorView, from: number, anchor: HTMLElement, focus: boolean): void { view.plugin(presentation)!.open(from, anchor, focus); }
	const presentation = ViewPlugin.fromClass(class {
		private destroyed = false;
		private pending = false;
		private popup: CodeLanguagePopup | null = null;
		private popupFrom: number | null = null;
		private dismissedFrom: number | null = null;
		constructor(readonly view: EditorView) { liveViews.add(view); this.schedule(); }
		open(from: number, anchor: HTMLElement, focus: boolean): void {
			if(this.popupFrom === from && this.popup) { if(focus)this.popup.focus(); return; }
			this.popup?.close();
			const position = getPosition();
			if(position === 'off')return;
			this.popupFrom = from;
			this.popup = openCodeLanguagePopup(this.view, from, anchor, {position, focus, onClose: dismissed => {
				this.popup = null; this.popupFrom = null;
				if(dismissed)this.dismissedFrom = from;
			}});
		}
		update(update: import('@codemirror/view').ViewUpdate): void {
			if (update.docChanged || !isActive(this.view) || update.startState.field(field).position !== getPosition()) this.popup?.close();
			if(update.selectionSet || (update.docChanged && !update.transactions.some(tr => tr.isUserEvent('input.code-language')))) this.dismissedFrom = null;
			this.schedule();
		}
		private syncBottom(): void {
			if(getPosition() !== 'bottom-right' || !isActive(this.view))return;
			const selection = this.view.state.selection.main;
			const block = selection.empty && (this.view.hasFocus || this.popup?.containsFocus())
				? this.view.state.field(field).blocks.find(candidate => candidate.from !== this.view.state.field(field).draft && selection.head >= candidate.from && selection.head <= candidate.to) : undefined;
			if(this.popup && block?.from !== this.popupFrom)this.popup.close();
			if(!block || this.popup || this.dismissedFrom === block.from)return;
			const anchor = this.view.contentDOM.querySelector<HTMLElement>(`.paraflow-code-ending[data-paraflow-code-block="${block.from}"]`);
			if(anchor)this.open(block.from, anchor, false);
		}
		private schedule(): void {
			if (this.pending) return;
			this.pending = true;
			queueMicrotask(() => {
				this.pending = false;
				if (this.destroyed) return;
				const active = isActive(this.view);
				if (active !== this.view.state.field(field).active) this.view.dispatch({ effects: activate.of(active) });
				this.syncBottom();
			});
		}
		destroy(): void { this.destroyed = true; liveViews.delete(this.view); this.popup?.close(); }
	});
	return [codeDraftState, codeDraftHistoryInversion, rememberCodeDraft, field, invertedEffects.of(tr=>tr.effects.filter(effect=>effect.is(virtualBodyEdit))), createCreationHistory('code',state=>state.facet(codeMarkersActive)), EditorView.atomicRanges.of(view => view.state.field(field).decorations),
		// Filters run in reverse precedence, before metadata selection normalization.
		Prec.lowest(EditorState.transactionFilter.of(tr => {
			const draft=tr.startState.facet(codeDraft),selection=tr.newSelection;
			const source=tr.startState.field(codeDraftState);
			if(!source.active&&source.sourceClose!==null&&tr.effects.some(effect=>effect.is(activate)&&effect.value)&&!tr.docChanged&&
				!tr.startState.readOnly&&!tr.startState.field(compositionStateField,false)){
				const owners=[...liveViews].filter(view=>view.state===tr.startState);
				if(owners.length===1&&isActive(owners[0]!)&&!owners[0]!.composing){
					const block=codeBlocksIn(tr.startState.doc).find(block=>block.from===source.sourceClose)!;
					// Container fences must close before any trailing rows outside their container.
					const fence=/`{3,}|~{3,}/u.exec(tr.startState.doc.lineAt(block.from).text)![0],suffix=tr.startState.sliceDoc(block.to);
					const insert=`\n${continuationPrefix(tr.startState,block)}${fence}${suffix.startsWith('\n')?'':'\n'}`;
					return [tr,{changes:{from:block.to,insert},sequential:true,userEvent:'input.code-close',annotations:isolateHistory.of('full')}];
				}
			}
			const enteringTail=tr.effects.find(effect=>effect.is(setVirtualTail))?.value;
			if(enteringTail&&selection.main.empty&&!draft?.typed&&!tr.docChanged&&!tr.startState.readOnly&&tr.startState.field(field).active){
				const block=codeBlocksIn(tr.startState.doc).find(block=>!block.indented&&!block.closed&&block.to===tr.startState.doc.length);
				if(block){
					const fence=/`{3,}|~{3,}/u.exec(tr.startState.doc.lineAt(block.from).text)![0],insert=`\n${continuationPrefix(tr.startState,block)}${fence}\n`;
					return [tr,{changes:{from:tr.startState.doc.length,insert},selection:{anchor:tr.startState.doc.length+insert.length},sequential:true,effects:setVirtualTail.of(enteringTail),userEvent:'input.code-close',annotations:isolateHistory.of('full')}];
				}
			}
			const event=tr.annotation(Transaction.userEvent);
			if(!draft?.typed||tr.docChanged||!tr.selection||tr.startState.readOnly||tr.startState.field(compositionStateField,false)||
				!['select','select.pointer','move.character','move.line'].includes(event??'')||excludedSelectionModeForTransaction(tr)||
				selection.ranges.length!==1||!selection.main.empty||!tr.startState.selection.main.empty||tr.startState.selection.ranges.length!==1||
				tr.startState.doc.lineAt(tr.startState.selection.main.head).from!==draft.from||
				(!isVirtualTailActive(tr.state)&&tr.startState.doc.lineAt(selection.main.head).from===draft.from))return tr;
			const owners=[...liveViews].filter(view=>view.state===tr.startState);
			// Transactions cannot identify their originating view when states are deliberately shared.
			if(owners.length!==1||!isActive(owners[0]!)||owners[0]!.composing)return tr;
			const opening=tr.startState.doc.lineAt(draft.from),block=discoverCodeBlocks(tr.startState).find(block=>block.from===draft.from)!;
			const fence=/`{3,}|~{3,}/u.exec(opening.text)![0],insert=`\n${continuationPrefix(tr.startState,block)}${fence}`;
			const tail=tr.effects.find(effect=>effect.is(setVirtualTail))?.value;
			const changes=tr.startState.changes({from:opening.to,insert}),mapped=tail?EditorSelection.create([EditorSelection.cursor(changes.newLength,1)]):selection.map(changes);
			return [tr,{changes,selection:mapped,sequential:true,userEvent:'input.code-create',annotations:isolateHistory.of('full'),effects:[
				...(tail?[setVirtualTail.of(tail)]:[]),
				codeDraftHistory.of({...draft,created:true}),creationHistory.of({owner:'code',from:draft.from,draftOffset:tr.startState.selection.main.head-draft.from,bodyOffset:mapped.main.head-draft.from,created:true}),
			]}];
		})),
		EditorView.mouseSelectionStyle.of((view, event) => {
			if (event.button !== 0 || !view.state.field(field).active) return null;
			const target = event.target as Element;
			if (target.closest('button')) return null;
			const edge = target.closest<HTMLElement>('.paraflow-code-heading,.paraflow-code-ending,.paraflow-code-ending-space');
			if (!edge) return null;
			const marker = edge.matches('.paraflow-code-ending-space') ? edge.firstElementChild as HTMLElement : edge;
			const block = view.state.field(field).blocks.find(candidate => String(candidate.from) === marker.dataset.paraflowCodeBlock)!;
			let anchor = marker.matches('.paraflow-code-heading') ? codeBodyStart(view.state, block) : block.lines.at(-1)?.to ?? codeBodyStart(view.state, block);
			let start = view.state.selection;
			return {
				update(update) {
					anchor = update.changes.mapPos(anchor);
					start = start.map(update.changes);
				},
				get(current, extend, multiple) {
					const head = current === event ? anchor : view.posAtCoords({x: current.clientX, y: current.clientY}, false);
					const range = extend ? start.main.extend(head) : EditorSelection.range(anchor, head);
					return extend ? start.replaceRange(range) : multiple ? start.addRange(range) : EditorSelection.create([range]);
				},
			};
		}),
		EditorState.transactionFilter.of(tr => {
			const value=tr.startState.field(field), selection=tr.startState.selection;
			if(!value.active || tr.startState.readOnly || !(tr.isUserEvent('input.type')||tr.isUserEvent('input.paste')) || !selection.main.empty || selection.ranges.length!==1)return tr;
			const block=value.blocks.find(block=>!block.indented&&!block.lines.length&&block.from!==value.draft&&tr.startState.doc.lineAt(block.from).to===selection.main.head);
			if(!block)return tr;
			const opening=tr.startState.doc.lineAt(block.from),prefix=continuationPrefix(tr.startState,block);
			let text:string|null=null, count=0;
			tr.changes.iterChanges((from,to,_fromB,_toB,insert)=>{count++;if(from===opening.to&&to===from)text=insert.toString();});
			if(count!==1 || text===null || !text)return tr;
			const insert=`\n${prefix}`, head=tr.newSelection.main.head+insert.length;
			return [tr,{changes:{from:opening.to,insert},selection:{anchor:head},sequential:true,annotations:isolateHistory.of('full'),
				effects:[virtualBodyEdit.of(null),creationHistory.of({owner:'code',from:block.from,draftOffset:opening.length,bodyOffset:head-block.from,created:true})]}];
		}),
		EditorState.transactionFilter.of(tr => {
			const value = tr.startState.field(field);
			const activating = tr.effects.some(effect => effect.is(activate) && effect.value);
			if (!value.active && !activating) return tr;
			const selection = codeEditableSelection(tr, value.blocks, activating);
			return selection ? [tr, {selection, sequential: true}] : tr;
		}),
		EditorState.transactionFilter.of(tr => {
			const value = tr.startState.field(field);
			if (!value.active || !tr.isUserEvent('delete') || tr.isUserEvent('delete.code-block') || tr.annotation(codeBlockEdit)) return tr;
			const crossed = new Set<CodeBlock>();
			tr.changes.iterChangedRanges((from, to) => {
				for (const block of value.blocks) {
					if (block.indented || value.draft === block.from) continue;
					for (const boundary of [tr.startState.doc.lineAt(block.from).to, ...(block.closed ? [block.barAt - 1] : [])]) {
						if (from <= boundary && to > boundary && !tr.startState.selection.ranges.some(range => range.from <= boundary && range.to > boundary)) crossed.add(block);
					}
				}
			});
			if (!crossed.size) return tr;
			const next = discoverCodeBlocks(tr.state);
			return [...crossed].every(block => next.some(candidate => candidate.closed === block.closed &&
				candidate.from === tr.changes.mapPos(block.from, -1) && (!block.closed || candidate.barAt === tr.changes.mapPos(block.barAt, 1)) &&
				tr.newDoc.lineAt(candidate.from).text === tr.startState.doc.lineAt(block.from).text &&
				(!block.closed || tr.newDoc.lineAt(candidate.barAt).text === tr.startState.doc.lineAt(block.barAt).text))) ? tr : [];
		}),
		Prec.highest(keymap.of([
			{ key: 'Enter', run: view => enterVirtualBody(view) || editBody(view, 'Enter') || createCode(view) },
			{ key: 'Shift-Enter', run: enterVirtualBody },
			{ key: 'Backspace', run: view => editBody(view, 'Backspace') || protectsMarker(view, true) || isActive(view) && deleteAdjacentCode(view, false) },
			{ key: 'Delete', run: view => editBody(view, 'Delete') || protectsMarker(view, false) || isActive(view) && deleteAdjacentCode(view, true) },
		])), presentation];
}
