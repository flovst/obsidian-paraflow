import {StateEffect,StateField} from '@codemirror/state';
import type {TableSource} from './edit-session';

interface TableRange {from:number;to:number;}
export const revealTableSource=StateEffect.define<TableRange>();

export function tableRawSourcePosition(table:TableSource,position:number):number {
	const line=table.source.slice(0,position).split('\n').length;
	return table.from+position+(table.container?.prefixes.slice(0,line).reduce((length,prefix)=>length+prefix.length,0)??0);
}

/** A source gesture reveals authored syntax until the selection leaves this table. */
export const tableSourceRevealState=StateField.define<TableRange|null>({
	create:()=>null,
	update(value,tr){
		const reveal=tr.effects.find(effect=>effect.is(revealTableSource));
		const range=reveal?.value??(value&&tr.docChanged?{from:tr.changes.mapPos(value.from,1),to:tr.changes.mapPos(value.to,-1)}:value);
		return range&&tr.state.selection.ranges.every(selection=>range.from<=selection.from&&selection.to<=range.to)?range:null;
	},
});
