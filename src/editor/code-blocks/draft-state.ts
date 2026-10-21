import {EditorState,Facet,StateEffect,StateField,type Transaction} from '@codemirror/state';
import {invertedEffects} from '@codemirror/commands';
import { codeBlocksIn } from './source-scan.js';
import {compositionStateField} from '../runtime/input-state.js';

export interface CodeDraft {from:number;to:number;end:number;typed:boolean}
export const activateCodeDraft = StateEffect.define<boolean>();
export const virtualBodyEdit = StateEffect.define<null>();
export const codeDraftHistory = StateEffect.define<{from:number;typed:boolean;created:boolean}>({
	map: (value,changes)=>({...value,from:changes.mapPos(value.from,-1)}),
});
export const codeDraft = Facet.define<CodeDraft|null,CodeDraft|null>({combine:values=>values[0]??null});
export const codeDraftStart = Facet.define<number|null,number|null>({combine:values=>values[0]??null});

function candidate(state:EditorState,from:number,typed:boolean):CodeDraft|null {
	const block=codeBlocksIn(state.doc).find(block=>block.from===from&&!block.indented&&(typed||!block.closed));
	return block ? {from,to:state.doc.lineAt(from).to,end:typed?state.doc.length:block.to,typed} : null;
}

function sourceClosingCandidate(previous:number|null,tr:Transaction):number|null {
	if(!tr.docChanged)return previous;
	const ending=codeBlocksIn(tr.newDoc).find(block=>!block.indented&&!block.closed&&/^\s*$/u.test(tr.newDoc.sliceString(block.to)));
	if(!ending)return null;
	const before=codeBlocksIn(tr.startState.doc).find(block=>!block.indented&&tr.changes.mapPos(block.from,-1)===ending.from&&(block.closed||block.from===previous));
	if(!before)return null;
	const opening=tr.startState.doc.lineAt(before.from),fence=/`{3,}|~{3,}/u.exec(opening.text)!;
	const from=opening.from+fence.index,to=from+fence[0].length;
	let replaced=false;
	tr.changes.iterChangedRanges((changedFrom,changedTo)=>{if(changedFrom<=from&&changedTo>=to)replaced=true;});
	return replaced?null:ending.from;
}

/** Source parsing keeps draft identity independent of the presentation/paragraph authority graph. */
export const codeDraftState = StateField.define<{active:boolean;draft:CodeDraft|null;sourceClose:number|null}>({
	create(state) {
		const head=state.selection.main.head,block=codeBlocksIn(state.doc).find(block=>!block.closed&&!block.indented&&!block.lines.length&&head>=block.from&&head<=block.to);
		return {active:false,draft:block?candidate(state,block.from,false):null,sourceClose:null};
	},
	update(value,tr) {
		const active=tr.effects.find(effect=>effect.is(activateCodeDraft))?.value??value.active;
		// Source presentation and initial ownership refreshes do not erase an unchanged opener.
		if(!active)return {active,draft:tr.docChanged?null:value.draft,sourceClose:sourceClosingCandidate(value.sourceClose,tr)};
		const replay=tr.effects.find(effect=>effect.is(codeDraftHistory));
		if(replay)return {active,draft:replay.value.created?null:candidate(tr.state,replay.value.from,replay.value.typed),sourceClose:null};
		if(tr.effects.some(effect=>effect.is(virtualBodyEdit)))return {active,draft:null,sourceClose:null};
		let replaced=false;
		if(value.draft&&tr.docChanged) {
			const opening=tr.startState.doc.lineAt(value.draft.from),fence=/`{3,}|~{3,}/u.exec(opening.text)!;
			const from=opening.from+fence.index,to=from+fence[0].length;
			// A new fence at the same mapped position does not inherit the removed opener's identity.
			tr.changes.iterChangedRanges((changedFrom,changedTo)=>{if(changedFrom<=from&&changedTo>=to)replaced=true;});
		}
		let draft=value.draft&&!replaced?candidate(tr.state,tr.changes.mapPos(value.draft.from,-1),value.draft.typed):null;
		if(draft&&!draft.typed&&(!tr.newSelection.main.empty||tr.newSelection.main.head<draft.from||tr.newSelection.main.head>draft.to))draft=null;
		if(!draft&&tr.docChanged&&tr.isUserEvent('input.type')&&!tr.isUserEvent('input.type.compose')&&!tr.startState.readOnly&&!tr.startState.field(compositionStateField,false)&&tr.newSelection.ranges.length===1&&tr.newSelection.main.empty) {
			const line=tr.newDoc.lineAt(tr.newSelection.main.head),next=candidate(tr.state,line.from,true);
			let local=false;
			tr.changes.iterChangedRanges((from,to,fromB,toB)=>{if(fromB>=line.from&&toB<=line.to&&tr.startState.doc.lineAt(from).number===tr.startState.doc.lineAt(to).number)local=true;});
			const oldLine=tr.startState.doc.lineAt(tr.changes.invertedDesc.mapPos(line.from));
			if(next&&local&&!codeBlocksIn(tr.startState.doc).some(block=>!block.indented&&block.from===oldLine.from))draft=next;
		}
		return {active,draft,sourceClose:null};
	},
	provide:field=>[codeDraft.from(field,value=>value.active?value.draft:null),codeDraftStart.from(field,value=>value.active?value.draft?.from??null:null)],
});

export const codeDraftHistoryInversion=invertedEffects.of(tr=>tr.effects.filter(effect=>effect.is(codeDraftHistory)).map(effect=>codeDraftHistory.of({...effect.value,
	from:effect.value.created&&tr.startState.facet(codeDraft)?tr.startState.facet(codeDraft)!.from:tr.changes.invertedDesc.mapPos(effect.value.from,-1),created:!effect.value.created})));

export const rememberCodeDraft=EditorState.transactionExtender.of(tr=>{
	if(!tr.docChanged||tr.isUserEvent('undo')||tr.isUserEvent('redo')||tr.effects.some(effect=>effect.is(codeDraftHistory)||effect.is(virtualBodyEdit)))return null;
	const before=tr.startState.facet(codeDraft),after=tr.state.facet(codeDraft);
	if(!before&&after?.typed)return {effects:codeDraftHistory.of({from:after.from,typed:true,created:false})};
	if(before?.typed&&!after)return {effects:codeDraftHistory.of({from:tr.changes.mapPos(before.from,-1),typed:true,created:true})};
	return null;
});
