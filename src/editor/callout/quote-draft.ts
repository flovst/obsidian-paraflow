import {Facet,MapMode,StateEffect,StateField,type EditorState,type Extension} from '@codemirror/state';
import {invertedEffects} from '@codemirror/commands';
import {parser} from '@lezer/markdown';
import {compositionStateField} from '../runtime/input-state.js';

export interface QuoteDraftMask {readonly from:number;readonly to:number}
const none:readonly QuoteDraftMask[]=[];
export const quoteDraftMasks=Facet.define<readonly QuoteDraftMask[],readonly QuoteDraftMask[]>({combine:values=>values[0]??none});
export const quoteDraftEnabled=Facet.define<(state:EditorState)=>boolean,(state:EditorState)=>boolean>({combine:values=>values[0]??(()=>false)});
export const activateQuoteDraft=StateEffect.define<boolean>();
const restoreQuoteDrafts=StateEffect.define<readonly QuoteDraftMask[]>({map:(masks,changes)=>masks.flatMap(mask=>{
	const from=changes.mapPos(mask.from,1,MapMode.TrackDel);return from===null?[]:[{from,to:from+1}];
})});

/** Mask only the pending marker; source offsets and enclosing container prefixes stay intact. */
export function maskQuoteDraftSource(source:string,masks:readonly QuoteDraftMask[]):string {
	let result='',position=0;
	for(const mask of masks){result+=source.slice(position,mask.from)+'x';position=mask.to;}
	return result+source.slice(position);
}

const quoteDraftState=StateField.define<{active:boolean;masks:readonly QuoteDraftMask[]}>({
	create:()=>({active:false,masks:none}),
	update(value,tr){
		const active=tr.state.facet(quoteDraftEnabled)(tr.state)&&(tr.effects.find(effect=>effect.is(activateQuoteDraft))?.value??value.active);
		const restore=tr.effects.find(effect=>effect.is(restoreQuoteDrafts));
		if(restore)return {active,masks:restore.value};
		if(!active)return {active,masks:tr.docChanged?none:value.masks};
		if(!tr.docChanged)return active===value.active?value:{active,masks:value.masks};
		const masks=value.masks.flatMap(mask=>{
			let replaced=false;tr.changes.iterChangedRanges((from,to)=>{if(from<=mask.from&&to>mask.from)replaced=true;});
			if(replaced)return [];
			const from=tr.changes.mapPos(mask.from,1);
			return tr.newDoc.sliceString(from,from+1)==='>'&&!/^[ \t]/u.test(tr.newDoc.sliceString(from+1,from+2))?[{from,to:from+1}]:[];
		});
		if(tr.isUserEvent('input.type')&&!tr.isUserEvent('input.type.compose')&&!tr.startState.readOnly&&!tr.startState.field(compositionStateField,false)&&tr.newSelection.ranges.length===1&&tr.newSelection.main.empty){
			const candidates:number[]=[];
			tr.changes.iterChanges((_from,_to,fromB,_toB,insert)=>{
				const text=insert.toString(),marker=fromB+text.indexOf('>');
				// Paragraph-tail typing may surround the single typed marker with separators.
				if(text.trim()==='>'&&marker+1===tr.newDoc.lineAt(marker).to)candidates.push(marker);
			});
			if(candidates.length)parser.parse(tr.newDoc.toString()).iterate({enter(node){
				if(node.name==='QuoteMark'&&candidates.includes(node.from))masks.push({from:node.from,to:node.from+1});
			}});
		}
		return {active,masks:masks.sort((a,b)=>a.from-b.from)};
	},
	provide:field=>quoteDraftMasks.from(field,value=>value.active?value.masks:none),
});

export function createQuoteDraftState(enabled:(state:EditorState)=>boolean):Extension {
	return [quoteDraftEnabled.of(enabled),quoteDraftState,invertedEffects.of(tr=>{
		if(!tr.docChanged)return [];
		const before=tr.startState.field(quoteDraftState).masks,after=tr.state.field(quoteDraftState).masks;
		return before.length||after.length?[restoreQuoteDrafts.of(before)]:[];
	})];
}
