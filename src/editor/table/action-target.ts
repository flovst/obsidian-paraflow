import type {EditorView} from '@codemirror/view';
import type {CellPosition,CellRectangle,TableModel} from './model';
import type {TableEditSession} from './edit-session';
import type {RowStructureChange} from './group-reconciliation';
import type {TableFocusBookmark} from './focus-handoff';

export interface TextBookmark {readonly cell:CellPosition;readonly from:number;readonly to:number;}
export interface TableActionTarget {
	readonly view:EditorView;
	readonly session:TableEditSession;
	readonly rectangle:CellRectangle;
	/** Track-format targeting uses the user's bounds, without merge closure. */
	readonly trackRectangle:CellRectangle;
	readonly positions:readonly CellPosition[];
	readonly textBookmark:TextBookmark|null;
	readonly focusBookmark:TableFocusBookmark;
	cellElement(position:CellPosition):HTMLElement|null;
	commit(table:TableModel|null,structural?:boolean,change?:RowStructureChange):void;
	replaceSource(source:string,change?:RowStructureChange,focus?:TableFocusBookmark):void;
	focus():void;
	clearPreview():void;
	preview(table:TableModel):()=>void;
	restoreTextSelection(bookmark:TextBookmark):void;
	selectTracks?(axis:'row'|'column'):void;
}

/** Menus retain the opening cell/text target when host menu focus changes selection. */
export function captureTableActionTarget(target:TableActionTarget):TableActionTarget {
	return {view:target.view,session:target.session,rectangle:{...target.rectangle},trackRectangle:{...target.trackRectangle},positions:[...target.positions],textBookmark:target.textBookmark,focusBookmark:target.focusBookmark,
		cellElement:position=>target.cellElement(position),commit:(table,structural,change)=>target.commit(table,structural,change),replaceSource:(source,change,focus)=>target.replaceSource(source,change,focus),focus:()=>target.focus(),clearPreview:()=>target.clearPreview(),preview:table=>target.preview(table),restoreTextSelection:bookmark=>target.restoreTextSelection(bookmark),
		...(target.selectTracks?{selectTracks:(axis:'row'|'column')=>target.selectTracks!(axis)}:{}),
	};
}

export function bookmarkRange(cell:HTMLElement,range:Range):{from:number;to:number} {
	const prefix=range.cloneRange();prefix.selectNodeContents(cell);prefix.setEnd(range.startContainer,range.startOffset);
	return {from:prefix.toString().length,to:prefix.toString().length+range.toString().length};
}

export function rangeFromBookmark(cell:HTMLElement,bookmark:{from:number;to:number}):Range {
	const range=cell.ownerDocument.createRange();range.selectNodeContents(cell);range.collapse(true);
	if(!cell.textContent&&bookmark.from===0&&bookmark.to===0)return range;
	const walker=cell.ownerDocument.createTreeWalker(cell,4);let offset=0;let start=false;let end=false;
	for(let node=walker.nextNode();node;node=walker.nextNode()){
		const length=node.textContent?.length??0;
		if(!start && bookmark.from<=offset+length){range.setStart(node,Math.max(0,bookmark.from-offset));start=true;}
		if(bookmark.to<=offset+length){range.setEnd(node,Math.max(0,bookmark.to-offset));end=true;break;}
		offset+=length;
	}
	if(!start || !end)throw new Error('The text selection changed. Please select it again.');
	return range;
}
