import {activateNativeCell,captureTableFocus,nativeFocusRectangle,requestTableFocus,updateTableFocusBookmark,type TableFocusBookmark} from './focus-handoff';
import {EditorView} from '@codemirror/view';
import {mapRenderedTextSelection} from './markdown-selection';
import type {CellPosition,CellRectangle,TableModel} from './model';
import {closeSelection} from './grid';
import {findTableSources,TableEditSession,type TableSource} from './edit-session';
import {replaceTableSource} from './toolbar-source';
import {bookmarkRange,rangeFromBookmark,type TableActionTarget,type TextBookmark} from './action-target';
import {showTextPreview} from './text-preview';
import type {RowStructureChange} from './group-reconciliation';

/** The host still owns pipe-table DOM, text editing, selection and row/column drag. */
export class NativeTableTarget implements TableActionTarget {
	readonly rectangle:CellRectangle;
	get trackRectangle():CellRectangle{return this.rectangle;}
	readonly positions:readonly CellPosition[];
	readonly textBookmark:TextBookmark|null;
	private restore:(()=>void)|undefined;
	private constructor(readonly view:EditorView,readonly session:TableEditSession,private readonly elements:readonly HTMLElement[],positions:readonly CellPosition[],textBookmark:TextBookmark|null,readonly focusBookmark:TableFocusBookmark){
		this.positions=positions;this.textBookmark=textBookmark;
		const rows=positions.map(position=>position.row);const columns=positions.map(position=>position.column);
		this.rectangle=closeSelection(session.table,{row:Math.min(...rows),column:Math.min(...columns)},{row:Math.max(...rows),column:Math.max(...columns)});
	}
	static replaceMarkdownSource(view:EditorView,source:TableSource,cell:HTMLElement|null,next:string,focus?:TableFocusBookmark,to=source.to):void {
		const bookmark=focus??(cell&&next?NativeTableTarget.captureSourceFocus(cell):undefined);
		// Host transaction filters can destroy the active native cell editor.
		const plan=replaceTableSource(view.state,source,next);
		// A native widget can end before GFM's plain-text continuation. Validate the
		// complete parser snapshot, but replace only the rendered table's range.
		if(to!==source.to)plan.changes={from:source.from,to,insert:next};
		const transaction=view.state.update(plan);
		if(bookmark)requestTableFocus(view,transaction,source.from,bookmark);
		view.dispatch(transaction);
	}
	static captureSourceFocus(cell:HTMLElement):TableFocusBookmark {
			const row=(cell.parentElement as HTMLTableRowElement).rowIndex,column=(cell as HTMLTableCellElement).cellIndex;
			const content=cell.querySelector<HTMLElement>('.cm-content')??cell;
			const selection=cell.ownerDocument.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;
			const offsets=range&&content.contains(range.startContainer)&&content.contains(range.endContainer)?bookmarkRange(content,range):{from:0,to:0};
			return {cell:{row,column},text:content.textContent??'',...offsets,rectangle:nativeFocusRectangle(cell)};
	}
	static fromView(view:EditorView,context:HTMLElement|null,includeTextSelection=true):NativeTableTarget|null {
		const tables=findTableSources(view.state.doc.toString());let position=view.state.selection.main.head;
		if(context&&view.dom.contains(context)){try{position=view.posAtDOM(context);}catch{/* Native table widgets map through the source selection. */}}
		const source=tables.find(table=>table.from<=position&&position<=table.to)??tables.find(table=>table.from<=view.state.selection.main.head&&view.state.selection.main.head<=table.to);
		if(!source)return null;
		const table=context?.closest<HTMLTableElement>('table')??view.dom.querySelector<HTMLTableElement>('.cm-table-widget.has-focus table.table-editor');
		const renderedTo=table?Math.min(source.to,view.state.doc.line(view.state.doc.lineAt(source.from).number+table.rows.length).to):source.to;
		const session=new TableEditSession(source,renderedTo);
		const elements=table?Array.from(table.querySelectorAll<HTMLElement>('td,th')).filter(cell=>cell.closest('table')===table):[];
		const selected=elements.filter(cell=>cell.classList.contains('is-selected'));
		const active=context?.closest<HTMLElement>('td,th')??elements.find(cell=>cell.contains(cell.ownerDocument.activeElement));
		const chosen=selected.length&&(!active||selected.includes(active))?selected:active?[active]:elements.slice(0,1);
		const positions=chosen.map(element=>{const index=elements.indexOf(element);return session.table.cells[index]!;}).filter(Boolean).map(({row,column})=>({row,column}));
		if(!positions.length)positions.push({row:0,column:0});
		let textBookmark:TextBookmark|null=null;
		const selection=view.dom.ownerDocument.getSelection();
		if(includeTextSelection&&selection?.rangeCount&&!selection.isCollapsed){
			const range=selection.getRangeAt(0);const cell=elements.find(element=>element.contains(range.commonAncestorContainer));
			if(cell){const index=elements.indexOf(cell);const model=session.table.cells[index]!;
				const mapped=captureTableFocus(cell,model,model.html);textBookmark={cell:{row:model.row,column:model.column},from:mapped.from,to:mapped.to};
			}
		}
		const focusCell=active??chosen[0];const model=focusCell?session.table.cells[elements.indexOf(focusCell)]!:session.table.cells[0]!;
		const focusBookmark=focusCell?{...captureTableFocus(focusCell,model,model.html),rectangle:nativeFocusRectangle(focusCell)}:{cell:{row:0,column:0},from:0,to:0,text:''};
		return new NativeTableTarget(view,session,elements,positions,textBookmark,focusBookmark);
	}
	cellElement(position:CellPosition):HTMLElement|null {const index=this.session.table.cells.findIndex(cell=>cell.row===position.row&&cell.column===position.column);return this.elements[index]??null;}
	selectTracks(axis:'row'|'column'):void {
		const bounds=this.trackRectangle,table=this.session.table;
		const first=this.cellElement({row:axis==='row'?bounds.top:0,column:axis==='column'?bounds.left:0}) as HTMLTableCellElement;
		const last=this.cellElement({row:axis==='row'?bounds.bottom:table.rows-1,column:axis==='column'?bounds.right:table.columns-1}) as HTMLTableCellElement;
		activateNativeCell(first);if(first!==last)activateNativeCell(last,true);
	}
	commit(table:TableModel|null,structural=false,change?:RowStructureChange):void {this.clearPreview();this.dispatch(table?this.session.serializeAction(table,structural,change):'',table===null,change);}
	replaceSource(source:string,change?:RowStructureChange,focus?:TableFocusBookmark):void {this.clearPreview();this.dispatch(source,!source,change,focus);}
	private dispatch(source:string,deleted:boolean,change?:RowStructureChange,focus=this.focusBookmark):void {
		const transaction=this.view.state.update(this.session.replace(this.view.state,source,change));
		if(!deleted)requestTableFocus(this.view,transaction,this.session.target.from,focus);
		this.view.dispatch(transaction);
	}
	focus():void {this.view.focus();}
	restoreTextSelection(bookmark:TextBookmark):void {
		if(updateTableFocusBookmark(this.view,bookmark))return;
		const native=this.cellElement(bookmark.cell);
		if(native?.isConnected){
			if(!native.querySelector('.cm-content'))activateNativeCell(native as HTMLTableCellElement);
			const content=native.querySelector<HTMLElement>('.cm-content'),nested=content?EditorView.findFromDOM(content):null;
			if(nested&&nested!==this.view){const model=this.session.table.cells.find(cell=>cell.row===bookmark.cell.row&&cell.column===bookmark.cell.column)!;const rendered=new native.ownerDocument.defaultView!.DOMParser().parseFromString(model.html,'text/html').body.textContent??'';const offsets=mapRenderedTextSelection(nested.state.doc.toString(),bookmark.from,bookmark.to,rendered);if(!offsets)throw new Error('文字选区已变化，请重新选择。');nested.dispatch({selection:{anchor:offsets.from,head:offsets.to}});nested.focus();return;}
		}
		const cell=this.view.dom.querySelector<HTMLElement>(`.paraflow-html-table-editor[data-pf-table-from="${this.session.target.from}"] [data-pf-row="${bookmark.cell.row}"][data-pf-column="${bookmark.cell.column}"]`)??native;
		if(!cell)return;cell.focus();const range=rangeFromBookmark(cell,bookmark);const selection=cell.ownerDocument.getSelection();selection?.removeAllRanges();selection?.addRange(range);
	}
	clearPreview():void {this.restore?.();this.restore=undefined;}
	preview(table:TableModel):()=>void {
		this.clearPreview();const restores:Array<()=>void>=[];
		const originals=new Map(this.session.table.cells.map(cell=>[`${cell.row}:${cell.column}`,cell]));
		for(const cell of table.cells){const model=originals.get(`${cell.row}:${cell.column}`);if(cell===model)continue;const element=this.cellElement(cell);if(!element)continue;
			const original=element.getAttribute('style');const role=element.dataset.pfPreviewRole;
			for(const property of Object.keys(model?.style??{}))if(!(property in cell.style))element.style.removeProperty(property);
			for(const [property,value] of Object.entries(cell.style)){const important=/\s*!important\s*$/iu.test(value);element.style.setProperty(property,value.replace(/\s*!important\s*$/iu,''),important?'important':'');}
			element.dataset.pfPreviewRole=cell.role;
			const clearText=cell.html!==model?.html?showTextPreview(element,cell.html):()=>{};
			restores.push(()=>{clearText();if(original===null)element.removeAttribute('style');else element.setAttribute('style',original);if(role===undefined)delete element.dataset.pfPreviewRole;else element.dataset.pfPreviewRole=role;});
		}
		let active=true;const restore=()=>{if(!active)return;active=false;for(const fn of restores)fn();};this.restore=restore;return restore;
	}
}
