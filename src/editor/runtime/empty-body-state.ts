import { invertedEffects } from '@codemirror/commands';
import { MapMode, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { paragraphEditAnnotation } from '../paragraph/edit-plan.js';
import { structuralEditAnnotation } from '../structured-list/edit-plan.js';

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
			const mapped=transaction.changes.mapPos(anchor,1,MapMode.TrackDel);return mapped===null?[]:[mapped];
		});
		for(const effect of transaction.effects) {
			if(effect.is(restoreBodies))anchors=[...effect.value];
			if(effect.is(registerEmptyBody))anchors.push(effect.value);
		}
		const operation=transaction.annotation(paragraphEditAnnotation);
		if(transaction.docChanged&&(operation==='enter'||operation==='shift-enter'||transaction.annotation(structuralEditAnnotation)==='shift-enter')&&transaction.newSelection.main.empty)anchors.push(transaction.newSelection.main.head);
		return [...new Set(anchors)].filter(anchor=>{
			const line=transaction.newDoc.lineAt(anchor);
			return anchor===line.to&&/^[ \t]*(?:>[ \t]*)*$/u.test(line.text);
		});
	},
});

export function emptyBodies(state:EditorState):readonly number[] {
	return state.field(emptyBodyState,false)??[];
}

const extension:Extension = [emptyBodyState,invertedEffects.of(transaction=>{
		if(!transaction.docChanged)return [];
		const before=emptyBodies(transaction.startState),after=emptyBodies(transaction.state);
		return before.length||after.length?[restoreBodies.of(before)]:[];
	})];

export function createEmptyBodies():Extension {
	return extension;
}
