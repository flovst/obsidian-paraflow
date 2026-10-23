import { markdownColumns } from '../structured-list/prefix.js';
import { invertedEffects } from '@codemirror/commands';
import { MapMode, StateEffect, StateField, type ChangeDesc, type EditorState, type Extension } from '@codemirror/state';
import { paragraphEditAnnotation } from '../paragraph/edit-plan.js';
import { structuralEditAnnotation } from '../structured-list/edit-plan.js';
import type { Transaction } from '@codemirror/state';

function externallyReplacesBody(transaction: Transaction, position: number): boolean {
	if (!transaction.docChanged || transaction.isUserEvent('input') || transaction.isUserEvent('delete') ||
		transaction.isUserEvent('undo') || transaction.isUserEvent('redo')) return false;
	const line = transaction.startState.doc.lineAt(position);
	let replaced = false;
	transaction.changes.iterChangedRanges((from, to) => {
		if (from <= line.from && to >= line.to) replaced = true;
	});
	return replaced;
}

export const registerEmptyBody = StateEffect.define<number>({
	map: (anchor, changes) => changes.mapPos(anchor, 1, MapMode.TrackDel) ?? undefined,
});
const restoreBodies = StateEffect.define<readonly number[]>({map:(anchors,changes)=>anchors.flatMap(anchor=>{
	const mapped=changes.mapPos(anchor,1,MapMode.TrackDel);return mapped===null?[]:[mapped];
})});

export const emptyBodyState = StateField.define<readonly number[]>({
	create:()=>[],
	update(value,transaction) {
		if(!transaction.docChanged&&!transaction.effects.some(effect=>effect.is(restoreBodies)||effect.is(registerEmptyBody)))return value;
		let anchors=value.flatMap(anchor=>{
			if (externallyReplacesBody(transaction, anchor)) return [];
			const mapped=transaction.changes.mapPos(anchor,1,MapMode.TrackDel);return mapped===null?[]:[mapped];
		});
		for(const effect of transaction.effects) {
			if(effect.is(restoreBodies))anchors=[...effect.value];
			if(effect.is(registerEmptyBody))anchors.push(effect.value);
		}
		const operation=transaction.annotation(paragraphEditAnnotation);
		const structuralOperation = transaction.annotation(structuralEditAnnotation);
		// Removing an empty marker creates the same editable body as a body split.
		// The final line check excludes conversions that instead promote a child item.
		const createsListBody = structuralOperation === 'shift-enter' || structuralOperation === 'enter-non-empty' ||
			structuralOperation === 'enter-task-non-empty' || structuralOperation === 'enter-empty-nested' ||
			structuralOperation === 'enter-empty-top-level' || structuralOperation === 'backspace-empty-nested' ||
			structuralOperation === 'backspace-empty-top-level';
		if(transaction.docChanged&&(operation==='enter'||operation==='shift-enter'||createsListBody)&&transaction.newSelection.main.empty)anchors.push(transaction.newSelection.main.head);
		if (transaction.docChanged && transaction.isUserEvent('delete') && transaction.startState.selection.main.empty && transaction.newSelection.main.empty) {
			const before = transaction.startState.doc.lineAt(transaction.startState.selection.main.head);
			const after = transaction.newDoc.lineAt(transaction.newSelection.main.head);
			// Removing the last character preserves its editable body; imported whitespace is not newly created.
			if (transaction.newSelection.main.head === after.to && !/^[ \t]*(?:>[ \t]*)*$/u.test(before.text) &&
				/^[ \t]*(?:>[ \t]*)*$/u.test(after.text)) anchors.push(after.to);
		}
		return [...new Set(anchors)].filter(anchor=>{
			const line=transaction.newDoc.lineAt(anchor);
			return anchor===line.to&&/^[ \t]*(?:>[ \t]*)*$/u.test(line.text);
		});
	},
});

export function emptyBodies(state:EditorState):readonly number[] {
	return state.field(emptyBodyState,false)??[];
}

const extension = ():Extension => [emptyBodyState,createdBodyOwnershipState,invertedEffects.of(transaction=>{
		if(!transaction.docChanged)return [];
		const before=emptyBodies(transaction.startState),after=emptyBodies(transaction.state);
		const ownedBefore=createdBodyOwnership(transaction.startState),ownedAfter=createdBodyOwnership(transaction.state);
		return [...(before.length||after.length?[restoreBodies.of(before)]:[]),
			...(ownedBefore.length||ownedAfter.length?[restoreOwnership.of(ownedBefore)]:[])];
	})];

export function createEmptyBodies():Extension {
	return extension();
}

/** A body created by an editing command keeps its structural boundary while its text changes. */
export interface CreatedBodyOwnership {
 readonly lineFrom:number;
 readonly bodyFrom:number;
 readonly ownerFrom:number|null;
 readonly prefix:string;
 readonly ownerPrefix:string;
 readonly maintenanceFrom?:number;
}
function mapOwnership(record:CreatedBodyOwnership,changes:ChangeDesc):CreatedBodyOwnership|null {
 const lineFrom=changes.mapPos(record.lineFrom,-1,MapMode.TrackDel);
 const bodyFrom=changes.mapPos(record.bodyFrom,-1,MapMode.TrackDel);
 const ownerFrom=record.ownerFrom===null?null:changes.mapPos(record.ownerFrom,-1,MapMode.TrackDel);
 if(lineFrom===null||bodyFrom===null||(record.ownerFrom!==null&&ownerFrom===null))return null;
 const originalMarker=record.maintenanceFrom;
 let markerDeleted=false;
 if(originalMarker!==undefined)changes.iterChangedRanges((from,to)=>{
  if(from<=originalMarker&&originalMarker<to)markerDeleted=true;
 });
 const maintenanceFrom=originalMarker===undefined||markerDeleted?null:changes.mapPos(originalMarker,1,MapMode.TrackDel);
 return {lineFrom,bodyFrom,ownerFrom,prefix:record.prefix,ownerPrefix:record.ownerPrefix,
  ...(maintenanceFrom===null?{}:{maintenanceFrom})};
}

const ownerMarker = /^([ \t]*(?:>[ \t]*)*)(?:[-+*]|\d+[.)])[ \t]+/u;

function mapSplitOwner(record: CreatedBodyOwnership, mapped: CreatedBodyOwnership, transaction: Transaction): CreatedBodyOwnership {
 if (record.ownerFrom === null) return mapped;
 const before = transaction.startState.doc.lineAt(record.ownerFrom);
 const after = transaction.newDoc.lineAt(transaction.changes.mapPos(before.to, 1));
 if (after.from === mapped.ownerFrom || after.from >= mapped.lineFrom) return mapped;
 const marker = ownerMarker.exec(after.text);
 // A split transfers the following bodies to the marker carrying the original suffix.
 if (!marker || marker[1] !== ownerMarker.exec(before.text)?.[1]) return mapped;
 return { ...mapped, ownerFrom: after.from, ownerPrefix: marker[0] };
}
const restoreOwnership = StateEffect.define<readonly CreatedBodyOwnership[]>({
 map:(records,changes)=>records.flatMap(record=>{const mapped=mapOwnership(record,changes);return mapped?[mapped]:[];}),
});

export const createdBodyOwnershipState = StateField.define<readonly CreatedBodyOwnership[]>({
 create:()=>[],
 update(value,tr) {
  if (!tr.docChanged && !tr.effects.some(effect=>effect.is(restoreOwnership)||effect.is(registerEmptyBody)))return value;
  let records:CreatedBodyOwnership[]=value.flatMap(record=>{
   if (externallyReplacesBody(tr, record.lineFrom)) return [];
   const positions=mapOwnership(record,tr.changes);
   if(!positions)return [];
   const mapped=mapSplitOwner(record,positions,tr);
   const {lineFrom,bodyFrom,ownerFrom}=mapped;
   const marker=mapped.maintenanceFrom;
   const maintenanceFrom=marker!==undefined&&tr.newDoc.sliceString(marker,marker+1)==='\u200b'?marker:undefined;
   const line=tr.newDoc.lineAt(lineFrom),owner=ownerFrom===null?null:tr.newDoc.lineAt(ownerFrom);
   return line.from===lineFrom&&tr.newDoc.sliceString(lineFrom,bodyFrom)===mapped.prefix&&(owner===null||(owner.from===ownerFrom&&owner.text.startsWith(mapped.ownerPrefix)))
    ? [{lineFrom,bodyFrom,ownerFrom,prefix:mapped.prefix,ownerPrefix:mapped.ownerPrefix,
       ...(maintenanceFrom===undefined?{}:{maintenanceFrom})}] : [];
  });
  for(const effect of tr.effects)if(effect.is(restoreOwnership))records=[...effect.value];

  if(tr.isUserEvent('input.paraflow.indent-maintenance'))tr.changes.iterChanges((from,to,newFrom,_newTo,insert)=>{
   if(from!==to||!insert.toString().endsWith('\u200b'))return;
   const established=value.find(body=>body.bodyFrom===from);
   if(!established)return;
   const lineFrom=tr.changes.mapPos(established.lineFrom,-1);
   records=records.map(body=>body.lineFrom===lineFrom?{...body,maintenanceFrom:newFrom+insert.length-1}:body);
  });

  for(const anchor of emptyBodies(tr.state)) {
   const line=tr.newDoc.lineAt(anchor);
   if(records.some(record=>record.lineFrom===line.from))continue;
   const prefix=line.text;
   let owner:CreatedBodyOwnership={lineFrom:line.from,bodyFrom:line.to,ownerFrom:null,prefix,ownerPrefix:''};
   for(let number=line.number-1;number>=1;number--) {
    const candidate=tr.newDoc.line(number);
    const marker=ownerMarker.exec(candidate.text);
    if(!marker) {
     if(candidate.text.trim() && markdownColumns(/^[ \t]*(?:>[ \t]*)*/u.exec(candidate.text)![0]) <= markdownColumns(prefix))break;
     continue;
    }
    if ((marker[1]!.match(/>/gu)?.length ?? 0) !== (prefix.match(/>/gu)?.length ?? 0)) break;
    if(markdownColumns(marker[0])>markdownColumns(prefix))continue;
    owner={lineFrom:line.from,bodyFrom:line.to,ownerFrom:candidate.from,prefix,ownerPrefix:marker[0]};
    break;
   }
   records.push(owner);
  }
  return records;
 }
});
export function createdBodyOwnership(state:EditorState):readonly CreatedBodyOwnership[] {
 return state.field(createdBodyOwnershipState,false)??[];
}
