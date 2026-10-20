import {captureTableFocus,requestTableFocus,clearTableFocus,updateTableFocusBookmark,type TableFocusBookmark} from './focus-handoff';
import {tableEdgeAxis} from './edge-hit';
import {redo,undo} from '@codemirror/commands';
import type {EditorView} from '@codemirror/view';
import {closeSelection,intersects} from './grid';
import type {CellPosition,CellRectangle,TableModel} from './model';
import {deleteTrack,insertTrack,mergeCells,unmergeCell} from './operations';
import {gridToHtml} from './serialization';
import {findEditableTableSources,TableEditSession} from './edit-session';
import type {TableEditingOptions} from './editing-types';
import {bookmarkRange,rangeFromBookmark,type TableActionTarget,type TextBookmark} from './action-target';
import {showTableActions} from './table-actions';
import {showTableContextMenu} from './html-context-menu';
import {isTableMenuTarget} from './native-menu';
import {admittedFragment} from './admitted-dom';
import {showTextPreview} from './text-preview';
import type {RowStructureChange} from './group-reconciliation';
import {moveTracksTo} from './reordering';
import {TableAddControls} from './add-controls';
import {deleteMarkdownTracks,insertMarkdownTrack,moveMarkdownTracks} from './toolbar-source';
import {readTrackGeometry,trackDropTarget,type TrackGeometry} from './track-geometry';
import {TableDragPreview} from './drag-preview';
import {TableOuterDragCursor} from './outer-drag-cursor';
import {exitHtmlTableDown} from './html-keyboard-exit';
import {blockExitPlan} from '../block-exit';
import {compositionStateField} from '../runtime/input-state';
import {isWikiAnchor,readWikiAnchor} from './wiki-links';
import {TableLinkPresentation} from './external-presentation';
import {HtmlTableSourceSelection} from './html-source-selection';
import {enterTableCell,tableRowCell} from './keyboard-entry';
import {goalXStoreFor,requireGoalXStore} from '../runtime/navigation-core';

const selectionOwners=new WeakMap<EditorView,Set<HtmlTableController>>();
interface CellTextSelection {cell:CellPosition;anchorNode:Node;anchorOffset:number;focusNode:Node;focusOffset:number;}

export class HtmlTableController implements TableActionTarget {
	readonly dom:HTMLElement;
	session:TableEditSession;
	rectangle:CellRectangle;
	trackRectangle:CellRectangle;
	private anchor:CellPosition;
	private current:CellPosition;
	private selecting=false;
	private ownsSelection=false;
	private pointerAnchor:CellPosition|null=null;
	private textAnchor:CellTextSelection|null=null;
	private previewRestore:(()=>void)|undefined;
	private menu:{close:()=>void}|undefined;
	private destroyed=false;
	private composing=false;
	private deletionBreaks:Set<Element>|null=null;
	private restoringFocus=false;
	private frozenText:TextBookmark|null=null;
	private sourceSelection:{session:TableEditSession;map:HtmlTableSourceSelection}|null=null;
	private readonly linkPresentation=new TableLinkPresentation();
	private addControls:TableAddControls|null=null;
	private trackDrag:{axis:'row'|'column';first:number;last:number;source:string;geometry:TrackGeometry;preview:TableDragPreview;cue:HTMLElement;point:{x:number;y:number}}|null=null;
	private dragFrame:number|null=null;
	private readonly outerCursor:TableOuterDragCursor;
	constructor(readonly view:EditorView,session:TableEditSession,readonly options:TableEditingOptions){
		this.session=session;this.current=this.anchor={row:0,column:0};this.rectangle=closeSelection(session.table,this.anchor,this.anchor);this.trackRectangle={top:0,left:0,bottom:0,right:0};
		this.dom=view.dom.ownerDocument.createElement('div');this.dom.className='paraflow-html-table-editor';this.dom.dataset.pfTableFrom=String(session.target.from);this.dom.setAttribute('contenteditable','false');
		let owners=selectionOwners.get(view);if(!owners){owners=new Set();selectionOwners.set(view,owners);}owners.add(this);
		this.render();
		this.refreshOptions();
		this.outerCursor=new TableOuterDragCursor(this.dom.ownerDocument,event=>this.outerHit(event)?.axis??null);
		this.dom.addEventListener('pointerdown',this.pointerDown);this.dom.addEventListener('pointermove',this.pointerMove);
		this.dom.ownerDocument.addEventListener('pointerup',this.pointerUp);
		this.dom.ownerDocument.addEventListener('pointermove',this.dragMove,true);
		this.dom.ownerDocument.addEventListener('scroll',this.scheduleDrag,true);
		this.dom.ownerDocument.defaultView!.addEventListener('blur',this.cancelDrag);
		this.dom.ownerDocument.defaultView!.addEventListener('resize',this.cancelDrag);
		this.dom.ownerDocument.addEventListener('pointercancel',this.cancelDrag);
		this.dom.ownerDocument.addEventListener('keydown',this.dragKeyDown,true);
		this.dom.ownerDocument.addEventListener('pointerdown',this.outerPointerDown,true);
		this.dom.ownerDocument.addEventListener('pointerdown',this.externalSelection,true);
		this.dom.ownerDocument.addEventListener('focusin',this.externalSelection,true);
		this.dom.ownerDocument.addEventListener('copy',this.copy,true);
		this.dom.ownerDocument.addEventListener('selectionchange',this.publishSourceSelection);
		this.dom.addEventListener('beforeinput',this.beforeInput);this.dom.addEventListener('input',this.input);this.dom.addEventListener('keydown',this.keyDown);
		this.dom.addEventListener('contextmenu',this.contextMenu);this.dom.addEventListener('paste',this.paste);
		this.dom.addEventListener('click',this.linkClick,true);
		this.dom.addEventListener('compositionstart',()=>{this.composing=true;});
		this.dom.addEventListener('compositionend',event=>{this.composing=false;this.input(event);});
		this.dom.addEventListener('focusin',event=>{if(this.restoringFocus)return;const cell=this.getEventCell(event);if(cell){this.claimSelection();this.current=this.position(cell);if(!this.selecting)this.select(this.current,this.current,false);}});
	}
	get positions():CellPosition[]{return this.session.table.cells.filter(cell=>intersects(cell,this.rectangle)).map(({row,column})=>({row,column}));}
	refreshOptions():void {
		if(this.options.getHideAddControls?.()!==false){this.addControls?.destroy();this.addControls=null;return;}
		if(!this.addControls)this.addControls=new TableAddControls(this.dom,()=>this.dom.querySelector('table')!,axis=>{
			try{this.insert(axis,axis==='row'?this.session.table.rows:this.session.table.columns);}catch(error){this.options.notify(error instanceof Error?error.message:String(error));}
		},()=>this.options.isActive(this.view)&&this.options.isActiveView?.(this.view)!==false);
	}
	get textBookmark():TextBookmark|null {
		if(this.frozenText)return this.frozenText;
		const selection=this.dom.ownerDocument.getSelection();if(!selection?.rangeCount||selection.isCollapsed)return null;
		const range=selection.getRangeAt(0);const cell=this.getNodeCell(range.startContainer);
		if(!cell||this.getNodeCell(range.endContainer)!==cell)return null;
		return {cell:this.position(cell),...bookmarkRange(cell,range)};
	}
	cellElement(position:CellPosition):HTMLElement|null{return this.dom.querySelector(`[data-pf-row="${position.row}"][data-pf-column="${position.column}"]`);}
	get focusBookmark():TableFocusBookmark {const cell=this.cellElement(this.current)!;return {...captureTableFocus(cell,this.current,cell.innerHTML),rectangle:this.selecting?this.rectangle:undefined};}
	restoreTextSelection(bookmark:TextBookmark):void {
		if(this.destroyed){updateTableFocusBookmark(this.view,bookmark);return;}
		const cell=this.cellElement(bookmark.cell);if(!cell)return;cell.focus();const range=rangeFromBookmark(cell,bookmark);const selection=cell.ownerDocument.getSelection();selection?.removeAllRanges();selection?.addRange(range);this.publishSourceSelection();
	}
	private sourceMap():HtmlTableSourceSelection {
		if(this.sourceSelection?.session!==this.session)this.sourceSelection={session:this.session,map:new HtmlTableSourceSelection(this.session,this.dom.ownerDocument)};
		return this.sourceSelection.map;
	}
	private publishSourceSelection=():void=>{
		if(this.destroyed||!this.ownsSelection||this.selecting||this.restoringFocus||this.composing||this.session.target.kind!=='html'||!this.options.isActive(this.view)||this.options.isActiveView?.(this.view)===false||!this.dom.contains(this.dom.ownerDocument.activeElement))return;
		const selection=this.dom.ownerDocument.getSelection(),cell=this.getNodeCell(selection?.anchorNode??null);
		if(!selection||!cell||!cell.contains(selection.focusNode))return;
		const next=this.sourceMap().selection(cell,this.position(cell),selection),current=this.view.state.selection.main;
		if(current.anchor!==next.anchor||current.head!==next.head)this.view.dispatch({selection:next});
	};
	restoreSourceSelection():boolean {
		if(this.session.target.kind!=='html')return false;
		const {anchor,head}=this.view.state.selection.main;this.restoringFocus=true;
		try{if(!this.sourceMap().restore(anchor,head,position=>this.cellElement(position)))return false;
			const cell=this.getNodeCell(this.dom.ownerDocument.activeElement)!;this.select(this.position(cell),this.position(cell),false);return true;
		}finally{this.restoringFocus=false;}
	}
	private position(cell:HTMLElement):CellPosition{return {row:Number(cell.dataset.pfRow),column:Number(cell.dataset.pfColumn)};}
	private getNodeCell(node:Node|null):HTMLElement|null {
		const element=node?.nodeType===1?node as HTMLElement:node?.parentElement;
		const cell=element?.closest<HTMLElement>('[data-pf-row]');return cell&&this.dom.contains(cell)?cell:null;
	}
	private getEventCell(event:Event):HTMLElement|null{return this.getNodeCell(event.target as Node);}
	private render():void {
		this.textAnchor=null;
		const fragment=admittedFragment(this.dom.ownerDocument,gridToHtml(this.session.envelope));
		const table=fragment.querySelector('table')!;table.className='paraflow-editable-table';table.setAttribute('aria-label','可编辑表格');
		this.linkPresentation.decorate(table);
		const elements=Array.from(table.querySelectorAll<HTMLElement>('td,th'));
		this.session.table.cells.forEach((cell,index)=>{
			const element=elements[index]!;element.dataset.pfRow=String(cell.row);element.dataset.pfColumn=String(cell.column);
			let tail=element.lastChild;
			while(tail?.nodeType===3&&/^[\t\r\n ]*$/u.test(tail.textContent!))tail=tail.previousSibling;
			// Empty contenteditable cells need a real line box for vertical caret alignment.
			if(!tail||tail instanceof element.ownerDocument.defaultView!.HTMLBRElement){const placeholder=element.ownerDocument.createElement('br');placeholder.dataset.paraflowCellPlaceholder='true';element.append(placeholder);}
			element.dataset.pfStripe=String(cell.row%2);element.setAttribute('contenteditable','true');element.setAttribute('tabindex','0');
			element.setAttribute('aria-label',`第 ${cell.row+1} 行，第 ${cell.column+1} 列`);element.spellcheck=true;
		});
		this.dom.replaceChildren(fragment);this.paintSelection();
	}
	update(session:TableEditSession):void {
		if(session.target.source===this.session.target.source&&session.target.from===this.session.target.from&&session.target.container?.rawSource===this.session.target.container?.rawSource)return;
		this.menu?.close();this.clearPreview();this.cancelDrag();const bookmark=this.textBookmark;
		const focused=this.dom.contains(this.dom.ownerDocument.activeElement);this.session=session;
		this.dom.dataset.pfTableFrom=String(session.target.from);this.current={row:Math.min(this.current.row,session.table.rows-1),column:Math.min(this.current.column,session.table.columns-1)};
		this.rectangle=closeSelection(session.table,this.current,this.current);this.render();
		const selection=this.view.state.selection.main;
		if(focused&&selection.from>=session.target.from&&selection.to<=session.target.to){
			if(this.restoreSourceSelection())return;
			if(!selection.empty)return;
			this.restoringFocus=true;try{this.placeCellCaret(this.current,bookmark?.from);}finally{this.restoringFocus=false;}
		}
	}
	select(start:CellPosition,end:CellPosition,rectangular=true):void {
		this.claimSelection(rectangular);
		this.anchor=start;this.current=end;this.trackRectangle={top:Math.min(start.row,end.row),left:Math.min(start.column,end.column),bottom:Math.max(start.row,end.row),right:Math.max(start.column,end.column)};this.rectangle=closeSelection(this.session.table,start,end);this.selecting=rectangular;this.paintSelection();
	}
	private claimSelection(rectangular=false):void {
		for(const owner of selectionOwners.get(this.view)!)if(owner!==this)owner.releaseSelection();
		this.ownsSelection=true;
		if(this.restoringFocus)return;
		const selection=this.view.state.selection;
		if(!rectangular&&this.session.target.kind==='html'&&selection.ranges.length===1&&selection.main.from>=this.session.target.from&&selection.main.to<=this.session.target.to)return;
		if(selection.ranges.length!==1||!selection.main.empty||selection.main.head!==this.session.target.from)this.view.dispatch({selection:{anchor:this.session.target.from}});
	}
	private externalSelection=(event:Event):void=>{
		const target=event.target as Node|null;
		if(isTableMenuTarget(target))return;
		if(event.defaultPrevented||!target||this.dom.contains(target)||(target as Element).closest?.('.paraflow-table-toolbar,.paraflow-table-menu,.paraflow-table-size-popup,.modal-container,.modal'))return;
		if(event.type==='focusin'&&target===this.dom.ownerDocument.body)return;
		this.ownsSelection=false;
		if(this.view.contentDOM.contains(target))this.releaseSelection();
	};
	private copy=(event:ClipboardEvent):void=>{
		const doc=this.dom.ownerDocument,selection=this.view.state.selection.main,target=event.target as Node|null;
		const textRange=doc.getSelection();
		if(this.ownsSelection&&textRange&&!textRange.isCollapsed&&textRange.rangeCount&&event.clipboardData){
			const range=textRange.getRangeAt(0),cell=this.getNodeCell(range.commonAncestorContainer);
			if(cell&&(cell.querySelector('[data-paraflow-cell-placeholder]')||this.linkPresentation.hasDerived(cell))){
				const fragment=this.linkPresentation.cloneRange(cell,range);for(const placeholder of fragment.querySelectorAll('[data-paraflow-cell-placeholder]'))placeholder.remove();
				const content=doc.createElement('div');content.append(fragment);
				event.clipboardData.setData('text/html',content.innerHTML);
				for(const br of content.querySelectorAll('br'))br.replaceWith(doc.createTextNode('\n'));
				event.clipboardData.setData('text/plain',content.textContent??'');event.preventDefault();event.stopPropagation();return;
			}
		}
		if(this.session.target.kind!=='html'||!this.ownsSelection||!this.selecting||this.destroyed||event.defaultPrevented||!event.clipboardData||!this.options.isActive(this.view)||this.options.isActiveView?.(this.view)===false||!selection.empty||selection.head!==this.session.target.from)return;
		if(target&&target!==doc.body&&!this.dom.contains(target))return;
		const textSelection=doc.getSelection();if(textSelection&&!textSelection.isCollapsed)return;
		const {top,left,bottom,right}=this.rectangle;
		const table:TableModel={rows:bottom-top+1,columns:right-left+1,cells:this.session.table.cells.filter(cell=>intersects(cell,this.rectangle)).map(cell=>({...cell,row:cell.row-top,column:cell.column-left}))};
		const rowGroups=this.session.envelope.rowGroups.flatMap(group=>{const start=Math.max(top,group.startRow),end=Math.min(bottom+1,group.startRow+group.rowCount);return start<end?[{...group,startRow:start-top,rowCount:end-start}]:[];});
		const fragment=gridToHtml({table,rowGroups});event.clipboardData.setData('text/plain',fragment);event.clipboardData.setData('text/html',fragment);event.preventDefault();event.stopPropagation();
	};
	releaseSelection():void {
		this.textAnchor=null;
		this.ownsSelection=false;this.cancelDrag();this.menu?.close();this.clearPreview();this.selecting=false;this.anchor=this.current;
		this.rectangle=closeSelection(this.session.table,this.current,this.current);this.trackRectangle={top:this.current.row,bottom:this.current.row,left:this.current.column,right:this.current.column};this.paintSelection();
	}
	selectTracks(axis:'row'|'column'):void {this.textAnchor=null;const rectangle=this.trackRectangle;this.select(axis==='row'?{row:rectangle.top,column:0}:{row:0,column:rectangle.left},axis==='row'?{row:rectangle.bottom,column:this.session.table.columns-1}:{row:this.session.table.rows-1,column:rectangle.right});}
	private paintSelection():void {
		const elements=Array.from(this.dom.querySelectorAll<HTMLElement>('td,th'));
		for(const [index,cell] of this.session.table.cells.entries()){const element=elements[index]!,selected=this.selecting&&intersects(cell,this.rectangle);element.setAttribute('aria-selected',String(selected));
			if(selected){const edges:string[]=[];if(cell.row===this.rectangle.top)edges.push('top');if(cell.column+cell.columnSpan-1===this.rectangle.right)edges.push('right');if(cell.row+cell.rowSpan-1===this.rectangle.bottom)edges.push('bottom');if(cell.column===this.rectangle.left)edges.push('left');element.dataset.pfSelectionEdges=edges.join(' ');}
			else delete element.dataset.pfSelectionEdges;
		}
		this.dom.classList.toggle('paraflow-cell-selection',this.selecting);
	}
	private pointerDown=(event:PointerEvent):void=>{
		const cell=this.getEventCell(event);if(!cell||event.button!==0)return;
		goalXStoreFor(this.view)?.write(null);
		const position=this.position(cell);this.current=position;
		if(event.shiftKey){event.preventDefault();this.textAnchor=null;this.select(this.anchor,position);this.dom.ownerDocument.getSelection()?.removeAllRanges();}
		else{this.pointerAnchor=position;this.textAnchor=null;this.select(position,position,false);const caret=this.pointerCaret(cell,event);if(caret)this.textAnchor={cell:position,anchorNode:caret.startContainer,anchorOffset:caret.startOffset,focusNode:caret.startContainer,focusOffset:caret.startOffset};}
	};
	private pointerCaret(cell:HTMLElement,event:MouseEvent):Range|null {
		const caret=cell.ownerDocument.caretPositionFromPoint?.(event.clientX,event.clientY);
		if(!caret||!cell.contains(caret.offsetNode))return null;
		const range=cell.ownerDocument.createRange();range.setStart(caret.offsetNode,caret.offset);range.collapse(true);return range;
	}
	private captureText(cell:HTMLElement):CellTextSelection|null {
		const selection=cell.ownerDocument.getSelection();
		return selection?.anchorNode&&selection.focusNode&&cell.contains(selection.anchorNode)&&cell.contains(selection.focusNode)
			?{cell:this.position(cell),anchorNode:selection.anchorNode,anchorOffset:selection.anchorOffset,focusNode:selection.focusNode,focusOffset:selection.focusOffset}:null;
	}
	private restoreText(anchor:CellTextSelection):void {
		this.select(anchor.cell,anchor.cell,false);this.cellElement(anchor.cell)!.focus();
		this.dom.ownerDocument.getSelection()!.setBaseAndExtent(anchor.anchorNode,anchor.anchorOffset,anchor.focusNode,anchor.focusOffset);
	}
	private startTrackDrag(event:PointerEvent,position:CellPosition,axis:'row'|'column'):void {
			event.preventDefault();this.pointerAnchor=null;this.textAnchor=null;
			const rectangle=this.rectangle,fullTracks=this.selecting&&(axis==='row'?rectangle.left===0&&rectangle.right===this.session.table.columns-1&&position.row>=rectangle.top&&position.row<=rectangle.bottom:rectangle.top===0&&rectangle.bottom===this.session.table.rows-1&&position.column>=rectangle.left&&position.column<=rectangle.right);
			if(!fullTracks)this.select(axis==='row'?{row:position.row,column:0}:{row:0,column:position.column},axis==='row'?{row:position.row,column:this.session.table.columns-1}:{row:this.session.table.rows-1,column:position.column});
			else this.claimSelection();
			const first=axis==='row'?this.rectangle.top:this.rectangle.left,last=axis==='row'?this.rectangle.bottom:this.rectangle.right;
			const table=this.dom.querySelector('table')!,point={x:event.clientX,y:event.clientY};
			const preview=new TableDragPreview(table,Array.from(table.querySelectorAll<HTMLElement>('[aria-selected="true"]')),axis,point);
			const cue=this.dom.ownerDocument.createElement('div');cue.className='paraflow-table-drag-cue';cue.dataset.pfAxis=axis;cue.hidden=true;preview.dom.append(cue);
			this.trackDrag={axis,first,last,source:this.session.target.source,geometry:readTrackGeometry(table,this.session.table,axis),preview,cue,point};this.dom.dataset.pfTrackDrag=axis;
	}
	private outerPointerDown=(event:PointerEvent):void=>{
		if(event.button!==0)return;const hit=this.outerHit(event);if(!hit)return;
		this.startTrackDrag(event,hit.position,hit.axis);event.stopPropagation();
	};
	private outerHit(event:MouseEvent):{axis:'row'|'column';position:CellPosition}|null {
		if(event.defaultPrevented||!this.options.isActive(this.view)||this.options.isActiveView?.(this.view)===false)return null;
		const element=event.target as Element;if(element.closest?.('.paraflow-table-toolbar,.paraflow-table-menu,.paraflow-table-size-popup,.menu,.modal,.modal-container,input,textarea,button,select'))return null;
		const table=this.dom.querySelector('table')!,box=table.getBoundingClientRect(),clip=this.dom.getBoundingClientRect(),viewport=this.view.scrollDOM.getBoundingClientRect();
		const edge=(Number.parseFloat(this.dom.ownerDocument.defaultView!.getComputedStyle(this.view.contentDOM).fontSize)||16)*.35;
		if(!box.width||!box.height||event.clientY<viewport.top||event.clientY>viewport.bottom||event.clientX<viewport.left||event.clientX>viewport.right)return null;
		const axis=tableEdgeAxis(event.clientX,event.clientY,box,clip,edge);
		if(!axis)return null;
		const geometry=readTrackGeometry(table,this.session.table,axis),coordinate=axis==='row'?event.clientY:event.clientX;
		const block=geometry.blocks.find(({first,last})=>coordinate>=Math.min(geometry.edges[first]!,geometry.edges[last+1]!)&&coordinate<=Math.max(geometry.edges[first]!,geometry.edges[last+1]!));
		if(!block)return null;const track=block.first;
		return {axis,position:axis==='row'?{row:track,column:0}:{row:0,column:track}};
	}
	private pointerMove=(event:PointerEvent):void=>{
		if(!this.trackDrag){const axis=this.outerHit(event)?.axis;if(axis)this.dom.dataset.pfTrackHover=axis;else delete this.dom.dataset.pfTrackHover;}
		if(this.trackDrag)return;
		if(!this.pointerAnchor||!(event.buttons&1))return;const cell=this.getEventCell(event);if(!cell)return;
		const position=this.position(cell);
		if(position.row===this.pointerAnchor.row&&position.column===this.pointerAnchor.column){
			if(this.selecting&&this.textAnchor){const caret=this.pointerCaret(cell,event);if(caret){event.preventDefault();this.restoreText({...this.textAnchor,focusNode:caret.startContainer,focusOffset:caret.startOffset});}}
			return;
		}
		if(!this.selecting){const anchorCell=this.cellElement(this.pointerAnchor)!;this.textAnchor??=this.captureText(anchorCell);}
		event.preventDefault();this.select(this.pointerAnchor,position);this.dom.ownerDocument.getSelection()?.removeAllRanges();
	};
	private dragTarget(drag:NonNullable<HtmlTableController['trackDrag']>,point:{x:number;y:number}):{destination:number;boundary:number}|null {
		const table=this.dom.querySelector('table')!,box=table.getBoundingClientRect();
		if(point.x<box.left||point.x>box.right||point.y<box.top||point.y>box.bottom)return null;
		const rtl=drag.axis==='column'&&drag.geometry.edges[0]!>drag.geometry.edges[drag.geometry.edges.length-1]!;
		const start=drag.axis==='row'?box.top:rtl?box.right:box.left,shift=start-drag.geometry.edges[0]!;
		const target=trackDropTarget(drag.geometry,drag.first,drag.last,(drag.axis==='row'?point.y:point.x)-shift);
		return target?{...target,boundary:target.boundary+shift}:null;
	}
	private dragMove=(event:PointerEvent):void=>{
		const drag=this.trackDrag;if(!drag)return;drag.point={x:event.clientX,y:event.clientY};drag.preview.update(drag.point);
		this.scheduleDrag();
	};
	private scheduleDrag=():void=>{
		const drag=this.trackDrag;if(!drag)return;
		if(this.dragFrame!==null)return;
		this.dragFrame=this.dom.ownerDocument.defaultView!.requestAnimationFrame(()=>{
			this.dragFrame=null;if(this.trackDrag!==drag)return;const target=this.dragTarget(drag,drag.point);
			drag.cue.hidden=!target||target.destination===drag.first;if(!target)return;drag.cue.dataset.pfDestination=String(target.destination);
			const box=this.dom.querySelector('table')!.getBoundingClientRect(),{left,top}=drag.preview.clipOrigin;
			if(drag.axis==='column'){drag.cue.style.left=`${Math.max(box.left,Math.min(target.boundary-1,box.right-2))-left}px`;drag.cue.style.top=`${box.top-top}px`;drag.cue.style.height=`${box.height}px`;}
			else{drag.cue.style.left=`${box.left-left}px`;drag.cue.style.top=`${Math.max(box.top,Math.min(target.boundary-1,box.bottom-2))-top}px`;drag.cue.style.width=`${box.width}px`;}
		});
	};
	private cancelDrag=():void=>{this.pointerAnchor=null;if(this.dragFrame!==null){this.dom.ownerDocument.defaultView!.cancelAnimationFrame(this.dragFrame);this.dragFrame=null;}this.trackDrag?.preview.destroy();this.trackDrag=null;delete this.dom.dataset.pfTrackDrag;delete this.dom.dataset.pfTrackHover;};
	private dragKeyDown=(event:KeyboardEvent):void=>{if(this.trackDrag&&event.key==='Escape'){event.preventDefault();this.cancelDrag();this.select(this.current,this.current,false);}};
	private pointerUp=(event:PointerEvent):void=>{
		this.pointerAnchor=null;const drag=this.trackDrag;if(!drag)return;const target=this.dragTarget(drag,{x:event.clientX,y:event.clientY});this.cancelDrag();
		if(!target)return;
		try{
			if(drag.source!==this.session.target.source)throw new Error('表格操作目标已变化，请重新选择。');
			const destination=target.destination;
			const next=moveTracksTo(this.session.table,drag.axis,drag.first,drag.last,destination);
			if(this.session.target.kind==='markdown')this.replaceSource(moveMarkdownTracks(this.session.target.source,drag.axis,drag.first,drag.last,destination),drag.axis==='row'?{kind:'move',first:drag.first,last:drag.last,direction:destination-drag.first}:undefined);
			else this.commit(next,true,drag.axis==='row'?{kind:'move',first:drag.first,last:drag.last,direction:destination-drag.first}:undefined);
		}catch(error){this.options.notify(error instanceof Error?error.message:String(error));}
	};
	private beforeInput=(event:InputEvent):void=>{
		const cell=this.getEventCell(event);
		this.deletionBreaks=cell&&event.inputType.startsWith('delete')?new Set(cell.querySelectorAll('br')):null;
	};
	private input=(event:Event):void=>{
		if(this.composing)return;const element=this.getEventCell(event);if(!element)return;
		const previousBreaks=this.deletionBreaks;this.deletionBreaks=null;
		// Chromium creates a BR caret carrier when deleting the final visible content.
		const tail=element.lastElementChild;
		if(previousBreaks&&tail?.tagName==='BR'&&!element.textContent?.trim()&&!previousBreaks.has(tail))tail.setAttribute('data-paraflow-cell-placeholder','true');
		this.clearPreview();const position=this.position(element);
		// Browsers may insert div for Enter. Standard paragraphs are the stored form.
		for(const div of Array.from(element.querySelectorAll('div'))){const p=element.ownerDocument.createElement('p');p.append(...Array.from(div.childNodes));div.replaceWith(p);}
		const content=this.linkPresentation.cloneCell(element);
		for(const placeholder of content.querySelectorAll('[data-paraflow-cell-placeholder]'))placeholder.remove();
		const table={...this.session.table,cells:this.session.table.cells.map(cell=>cell.row===position.row&&cell.column===position.column?{...cell,html:content.innerHTML}:cell)};
		try{this.writeSource(this.session.serializeContent(table),false);}catch(error){this.options.notify(error instanceof Error?error.message:String(error));this.render();this.focusCell(position);}
	};
	commit(table:TableModel|null,structural=true,change?:RowStructureChange):void {this.writeSource(table?this.session.serializeAction(table,structural,change):null,structural,change);}
	replaceSource(source:string,change?:RowStructureChange,focus?:TableFocusBookmark):void {this.writeSource(source||null,true,change,focus);}
	insertRowAfter(row:number):void {
		const index=row+1,change={kind:'insert' as const,index},focus={cell:{row:index,column:0},from:0,to:0,text:''};
		const next=this.session.target.kind==='markdown'?insertMarkdownTrack(this.session.target.source,'row',index):this.session.serializeAction(insertTrack(this.session.table,'row',index),true,change);
		this.replaceSource(next,change,focus);
	}
	private insert(axis:'row'|'column',index:number):void {
		if(this.session.target.kind==='markdown')this.replaceSource(insertMarkdownTrack(this.session.target.source,axis,index),axis==='row'?{kind:'insert',index}:undefined);
		else this.commit(insertTrack(this.session.table,axis,index),true,axis==='row'?{kind:'insert',index}:undefined);
	}
	private writeSource(nextSource:string|null,structural:boolean,change?:RowStructureChange,focus?:TableFocusBookmark):void {
		if(this.destroyed||!this.options.isActive(this.view))throw new Error('表格编辑已关闭。');
		this.clearPreview();
		const selection=this.dom.ownerDocument.getSelection();const selectedRange=selection?.rangeCount?selection.getRangeAt(0):null;
		const selectedCell=selectedRange?this.getNodeCell(selectedRange.startContainer):null;
		const caret=selectedRange&&selectedCell&&selectedCell.contains(selectedRange.endContainer)?bookmarkRange(selectedCell,selectedRange):null;
		const focused=!!focus||this.dom.contains(this.dom.ownerDocument.activeElement);
		if(nextSource===this.session.target.source)return;
		const transaction=this.view.state.update(this.session.replace(this.view.state,nextSource??'',change));
		if(nextSource!==null&&focused){const cell=selectedCell??this.cellElement(this.current)!;requestTableFocus(this.view,transaction,this.session.target.from,focus??{...captureTableFocus(cell,this.current,cell.innerHTML),rectangle:this.selecting?this.rectangle:undefined});}
		if(nextSource!==null)this.session=new TableEditSession(findEditableTableSources(transaction.state).find(target=>target.from===this.session.target.from)!);
		const replacementSession=this.session;
		this.view.dispatch(transaction);
		// The host can reuse this widget for another table during representation changes.
		if(this.destroyed||this.session!==replacementSession)return;
		clearTableFocus(this.view);
		if(nextSource!==null){const table=this.session.table;if(focus)this.current=focus.cell;if(structural){this.current={row:Math.min(this.current.row,table.rows-1),column:Math.min(this.current.column,table.columns-1)};this.rectangle=focus?.rectangle??closeSelection(table,this.current,this.current);this.trackRectangle={...this.rectangle};}this.render();if(focused){const offsets=focus??caret;this.focusCell(this.current,offsets?.to);if(offsets&&offsets.from!==offsets.to)this.restoreTextSelection({cell:this.current,from:offsets.from,to:offsets.to});}}
	}
	async merge():Promise<void> {
		const session=this.session;const merged=mergeCells(session.table,this.rectangle);
		if(merged.table===session.table)return;
		if(merged.discardedCells.length&&this.options.getMergeWarning()){
			const decision=await this.options.confirmMerge();if(!decision.confirmed)return;
			session.assertCurrent(this.view.state);
			if(decision.suppressWarning)await this.options.setMergeWarning(false);
		}
		session.assertCurrent(this.view.state);if(this.options.isActiveView?.(this.view)===false)throw new Error('表格编辑目标已变化，请重新选择。');this.commit(merged.table);this.focus();
	}
	focus():void {this.focusCell(this.current);}
	private focusCell(position:CellPosition,offset?:number):void {
		this.claimSelection();
		this.placeCellCaret(position,offset);
	}
	private placeCellCaret(position:CellPosition,offset?:number):void {
		const cell=this.session.table.cells.find(candidate=>intersects(candidate,{top:position.row,bottom:position.row,left:position.column,right:position.column}));
		if(!cell)return;const element=this.cellElement(cell)!;element.focus();
		const selection=element.ownerDocument.getSelection();const range=element.ownerDocument.createRange();range.selectNodeContents(element);range.collapse(offset===0);
		if(offset!==undefined&&element.textContent?.length){const bookmark=rangeFromBookmark(element,{from:Math.min(offset,element.textContent.length),to:Math.min(offset,element.textContent.length)});selection?.removeAllRanges();selection?.addRange(bookmark);}
		else{selection?.removeAllRanges();selection?.addRange(range);}
		this.publishSourceSelection();
	}
	private keyDown=(event:KeyboardEvent):void=>{
		if(event.isComposing||this.composing||this.view.composing||this.view.state.field(compositionStateField,false)||this.view.state.readOnly||!this.options.isActive(this.view)||this.options.isActiveView?.(this.view)===false)return;const mod=event.ctrlKey||event.metaKey;
		if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')goalXStoreFor(this.view)?.write(null);
		if(!mod&&!event.altKey&&this.options.isActive(this.view)&&this.options.isActiveView?.(this.view)!==false&&this.arrowSelection(event))return;
		if(!mod&&!event.altKey&&!event.shiftKey&&this.verticalCellMovement(event))return;
		if(this.options.isActive(this.view)&&this.options.isActiveView?.(this.view)!==false&&exitHtmlTableDown(this.view,this.session,event))return;
		if(mod&&event.key.toLowerCase()==='z'){event.preventDefault();event.stopPropagation();(event.shiftKey?redo:undo)(this.view);return;}
		if(mod&&event.key.toLowerCase()==='y'){event.preventDefault();event.stopPropagation();redo(this.view);return;}
		if(event.key==='Enter'&&!event.shiftKey){
			const cell=this.getEventCell(event);
			if(event.altKey||!cell)return;
			const selection=cell.ownerDocument.getSelection();if(this.selecting&&this.positions.length>1||!selection||selection.rangeCount!==1||!cell.contains(selection.anchorNode)||!cell.contains(selection.focusNode))return;
			const last=Number(cell.dataset.pfRow)+(cell as HTMLTableCellElement).rowSpan===this.session.table.rows;
			if(mod||last){
				event.preventDefault();event.stopPropagation();
				if(mod)this.insertRowAfter(Number(cell.dataset.pfRow));
				else{this.view.dispatch(blockExitPlan(this.view.state,this.session.target.to,this.session.target.container?.prefixes[0]??''));this.view.focus();}
				return;
			}
		}
		if(event.key==='Enter'){
			event.preventDefault();event.stopPropagation();this.clearPreview();
			if(event.shiftKey){
				const cell=this.getEventCell(event);const selection=this.dom.ownerDocument.getSelection();if(!cell||!selection?.rangeCount)return;
				const range=selection.getRangeAt(0);if(!cell.contains(range.commonAncestorContainer))return;
				const prefix=range.cloneRange();prefix.selectNodeContents(cell);prefix.setEnd(range.startContainer,range.startOffset);const index=prefix.cloneContents().querySelectorAll('br').length;
				range.deleteContents();const br=cell.ownerDocument.createElement('br');range.insertNode(br);range.setStartAfter(br);range.collapse(true);selection.removeAllRanges();selection.addRange(range);this.input(event);
				const current=this.cellElement(this.current)!;current.focus();const inserted=current.querySelectorAll('br')[index];if(inserted){
					if(inserted===current.lastChild){const placeholder=current.ownerDocument.createElement('br');placeholder.dataset.paraflowCellPlaceholder='true';current.append(placeholder);}
					const caret=current.ownerDocument.createRange();caret.setStartAfter(inserted);caret.collapse(true);selection.removeAllRanges();selection.addRange(caret);
				}
			}else{
				const cell=this.getEventCell(event)!;const current=this.position(cell),row=current.row+(cell as HTMLTableCellElement).rowSpan;
				const next=this.session.table.cells.find(candidate=>intersects(candidate,{top:row,bottom:row,left:current.column,right:current.column}))!;
				this.select(next,next,false);this.focusCell(next,0);
				const target=this.cellElement(next)!,range=target.ownerDocument.createRange();range.selectNodeContents(target);
				const selection=target.ownerDocument.getSelection()!;selection.removeAllRanges();selection.addRange(range);this.publishSourceSelection();
			}return;
		}
		if(event.key==='Tab'){
			event.preventDefault();event.stopPropagation();const cells=this.session.table.cells;const index=cells.findIndex(cell=>cell.row===this.current.row&&cell.column===this.current.column);const next=cells[index+(event.shiftKey?-1:1)];
			if(next){this.select(next,next,false);this.focusCell(next,0);const cell=this.cellElement(next)!;const range=cell.ownerDocument.createRange();range.selectNodeContents(cell);const selection=cell.ownerDocument.getSelection();selection?.removeAllRanges();selection?.addRange(range);}
			else if(!event.shiftKey)this.insertRowAfter(this.session.table.rows-1);
			else{this.view.focus();this.view.dispatch({selection:{anchor:this.session.target.from},scrollIntoView:true});}return;
		}
		if(event.key==='Escape'){event.preventDefault();this.cancelDrag();this.textAnchor=null;this.select(this.current,this.current,false);this.menu?.close();return;}
		if(this.selecting&&(event.key==='Backspace'||event.key==='Delete')){event.preventDefault();event.stopPropagation();this.writeSource(this.session.serializeContent({...this.session.table,cells:this.session.table.cells.map(cell=>intersects(cell,this.rectangle)?{...cell,html:''}:cell)}),false);this.render();return;}
	};
	private verticalCellMovement(event:KeyboardEvent):boolean {
		if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return false;
		const cell=this.getEventCell(event) as HTMLTableCellElement|null,selection=this.dom.ownerDocument.getSelection();
		if(!cell||!selection?.isCollapsed||!selection.rangeCount)return false;
		const text=this.captureText(cell);if(!text||!this.textBoundary(cell,text,event.key))return false;
		const forward=event.key==='ArrowDown',row=Number(cell.dataset.pfRow)+(forward?cell.rowSpan:-1);
		const table=cell.closest('table')!,store=requireGoalXStore(this.view),left=this.view.contentDOM.getBoundingClientRect().left;
		const caret=Array.from(selection.getRangeAt(0).getClientRects()).find(box=>box.height>0);
		const goal=store.read()??(caret?.left??cell.getBoundingClientRect().left)-left;
		const next=tableRowCell(table,row,left+goal);if(!next)return false;
		enterTableCell(this.view,next,left+goal,forward);this.publishSourceSelection();store.write(goal);
		event.preventDefault();event.stopPropagation();return true;
	}
	private arrowSelection(event:KeyboardEvent):boolean {
		if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return false;
		const forward=event.key==='ArrowRight'||event.key==='ArrowDown';
		if(!event.shiftKey){
			this.textAnchor=null;if(!this.selecting)return false;
			event.preventDefault();event.stopPropagation();this.select(this.current,this.current,false);this.focusCell(this.current,forward?undefined:0);return true;
		}
		const cell=this.cellElement(this.current)!;
		if(!this.selecting){
			const text=this.captureText(cell);if(!text||!this.textBoundary(cell,text,event.key))return false;
			this.textAnchor=text;
		}
		const model=this.session.table.cells.find(candidate=>candidate.row===this.current.row&&candidate.column===this.current.column)!;
		const row=this.current.row+(event.key==='ArrowDown'?model.rowSpan:event.key==='ArrowUp'?-1:0);
		const column=this.current.column+(event.key==='ArrowRight'?model.columnSpan:event.key==='ArrowLeft'?-1:0);
		const next=this.session.table.cells.find(candidate=>intersects(candidate,{top:row,bottom:row,left:column,right:column}));
		if(!next){if(!this.selecting)return false;event.preventDefault();event.stopPropagation();return true;}
		event.preventDefault();event.stopPropagation();const anchor=this.textAnchor;
		if(anchor&&next.row===anchor.cell.row&&next.column===anchor.cell.column)this.restoreText(anchor);
		else{this.select(anchor?.cell??this.anchor,next);this.dom.ownerDocument.getSelection()!.removeAllRanges();}
		return true;
	}
	private textBoundary(cell:HTMLElement,text:CellTextSelection,key:string):boolean {
		const caret=cell.ownerDocument.createRange();caret.setStart(text.focusNode,text.focusOffset);caret.collapse(true);
		const offset=bookmarkRange(cell,caret).from;
		if(key==='ArrowLeft')return offset===0;
		if(key==='ArrowRight')return offset===cell.textContent.length;
		const content=cell.ownerDocument.createRange();content.selectNodeContents(cell);
		const boxes=Array.from(content.getClientRects()).filter(box=>box.height>0),point=Array.from(caret.getClientRects()).find(box=>box.height>0);
		if(!boxes.length)return !cell.textContent;
		if(!point)return false;
		const center=point.top+point.height/2;
		return key==='ArrowUp'?center<Math.min(...boxes.map(box=>box.bottom)):center>Math.max(...boxes.map(box=>box.top));
	}
	private paste=(event:ClipboardEvent):void=>{
		const cell=this.getEventCell(event);if(!cell||!event.clipboardData)return;event.preventDefault();event.stopPropagation();
		const selection=cell.ownerDocument.getSelection();if(!selection?.rangeCount)return;const range=selection.getRangeAt(0);
		if(!cell.contains(range.commonAncestorContainer))return;
		range.deleteContents();const fragment=cell.ownerDocument.createDocumentFragment();const lines=event.clipboardData.getData('text/plain').split(/\r?\n/u);
		lines.forEach((line,index)=>{if(index)fragment.append(cell.ownerDocument.createElement('br'));fragment.append(cell.ownerDocument.createTextNode(line));});
		const last=fragment.lastChild;range.insertNode(fragment);if(last){range.setStartAfter(last);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}
		this.input(event);
	};
	private contextMenu=(event:MouseEvent):void=>{
		const cell=this.getEventCell(event);if(!cell)return;event.preventDefault();event.stopPropagation();
		const position=this.position(cell);if(!this.selecting||!intersects(this.session.table.cells.find(candidate=>candidate.row===position.row&&candidate.column===position.column)!,this.rectangle))this.select(position,position,false);
		this.showContextMenu({x:event.clientX,y:event.clientY});
	};
	private linkClick=(event:MouseEvent):void=>{
		const element=event.target as Element,anchor=element.closest('a');if(!anchor||!isWikiAnchor(anchor))return;
		event.preventDefault();event.stopPropagation();if(!event.ctrlKey&&!event.metaKey)return;
		if(!this.options.openWikiLink){this.options.notify('内部链接导航未连接到宿主。');return;}
		try{const link=readWikiAnchor(anchor);void Promise.resolve(this.options.openWikiLink(this.view,link.target,true)).catch(error=>this.options.notify(error instanceof Error?error.message:String(error)));}catch(error){this.options.notify(error instanceof Error?error.message:String(error));}
	};
	showContextMenu(point:{x:number;y:number}):void {this.menu?.close();this.frozenText=this.textBookmark;this.menu=showTableContextMenu(this,this.options,point,bookmark=>{this.frozenText=bookmark;this.menu=showTableActions(this,this.options,point,()=>{this.frozenText=null;});},()=>{this.frozenText=null;});}
	showMenu(point:{x:number;y:number}):void {this.menu?.close();this.frozenText=this.textBookmark;this.menu=showTableActions(this,this.options,point,()=>{this.frozenText=null;});}
	clearPreview():void {this.previewRestore?.();this.previewRestore=undefined;}
	preview(table:TableModel):()=>void {
		this.clearPreview();const restore:Array<()=>void>=[];
		const originals=new Map(this.session.table.cells.map(cell=>[`${cell.row}:${cell.column}`,cell]));const scroll=this.view.scrollDOM.scrollTop;
		for(const cell of table.cells){const original=originals.get(`${cell.row}:${cell.column}`);if(cell===original)continue;const element=this.cellElement(cell);if(!element)continue;const before=element.getAttribute('style');const role=element.dataset.pfPreviewRole;
			element.setAttribute('style',Object.entries(cell.style).map(([key,value])=>`${key}:${value}`).join(';'));element.dataset.pfPreviewRole=cell.role;
			const clearText=cell.html!==original?.html?showTextPreview(element,cell.html):()=>{};
			restore.push(()=>{clearText();if(before===null)element.removeAttribute('style');else element.setAttribute('style',before);if(role===undefined)delete element.dataset.pfPreviewRole;else element.dataset.pfPreviewRole=role;});
		}
		this.view.scrollDOM.scrollTop=scroll;
		let active=true;const undo=()=>{if(!active)return;active=false;for(const run of restore)run();this.view.scrollDOM.scrollTop=scroll;};this.previewRestore=undo;return undo;
	}
	destroy():void {this.destroyed=true;this.dom.ownerDocument.removeEventListener('selectionchange',this.publishSourceSelection);this.outerCursor.destroy();selectionOwners.get(this.view)?.delete(this);this.menu?.close();this.clearPreview();this.addControls?.destroy();this.cancelDrag();this.dom.ownerDocument.removeEventListener('copy',this.copy,true);this.dom.ownerDocument.removeEventListener('pointerdown',this.outerPointerDown,true);this.dom.ownerDocument.removeEventListener('pointerup',this.pointerUp);this.dom.ownerDocument.removeEventListener('pointermove',this.dragMove,true);this.dom.ownerDocument.removeEventListener('scroll',this.scheduleDrag,true);this.dom.ownerDocument.defaultView!.removeEventListener('blur',this.cancelDrag);this.dom.ownerDocument.defaultView!.removeEventListener('resize',this.cancelDrag);this.dom.ownerDocument.removeEventListener('pointercancel',this.cancelDrag);this.dom.ownerDocument.removeEventListener('keydown',this.dragKeyDown,true);this.dom.ownerDocument.removeEventListener('pointerdown',this.externalSelection,true);this.dom.ownerDocument.removeEventListener('focusin',this.externalSelection,true);}
	unmerge():void {this.commit(unmergeCell(this.session.table,this.current));}
	deleteCurrent(axis:'row'|'column',resetCaret=false):void {
		const change=axis==='row'?{kind:'delete' as const,index:this.current.row,count:1}:undefined,table=deleteTrack(this.session.table,axis,this.current[axis]);
		let focus:TableFocusBookmark|undefined;
		if(resetCaret&&table){
			const position={row:Math.min(this.current.row,table.rows-1),column:Math.min(this.current.column,table.columns-1)};
			const cell=table.cells.find(cell=>intersects(cell,{top:position.row,bottom:position.row,left:position.column,right:position.column}))!;
			focus={cell:{row:cell.row,column:cell.column},from:0,to:0,text:admittedFragment(this.dom.ownerDocument,cell.html).textContent??''};
		}
		if(this.session.target.kind==='markdown')this.replaceSource(deleteMarkdownTracks(this.session.target.source,axis,this.current[axis],this.current[axis]),change,focus);
		else this.writeSource(table?this.session.serializeAction(table,true,change):null,true,change,focus);
	}
}
