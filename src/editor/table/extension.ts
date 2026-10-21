import {clearTableActivationResume,clearTableFocus,hasTableActivationRequest,hasTableFocusRequest,resumeHtmlActivationFocus,restoreTableFocus,tableFocusOwner,type TableFocusBookmark} from './focus-handoff';
import {Prec,StateEffect,StateField,type EditorState,type Extension,type Range} from '@codemirror/state';
import {Decoration,EditorView,ViewPlugin,WidgetType} from '@codemirror/view';
import {findEditableTableSources,TableEditSession,type TableSource} from './edit-session';
import type {TableEditingOptions} from './editing-types';
import {HtmlTableController} from './html-editor';
import {createTable,gridToHtml,TableSerializationError,type HtmlTable} from './serialization';
import {isolateHistory} from '@codemirror/commands';
import {NativeTableTarget} from './native-target';
import {clearTableActions} from './table-actions';
import {isTableMenuTarget} from './native-menu';
import {TableFocusToolbar,type TableToolbarTarget} from './focus-toolbar';
import {deleteMarkdownTracks,formatMarkdownTable,insertMarkdownTrack,markdownDimensions} from './toolbar-source';
import {tableMergeActions} from './merge-actions';
import type {TableMenuItem} from './popup';
import {showTableContextMenu} from './html-context-menu';
import {tableSourceActions} from './source-actions';
import {nativeSourceMenu} from './native-source-menu';
import {NativeTableControls} from './native-controls';
import {NativeTableDragPreview} from './native-drag-preview';
import {NativeTableTextSelection} from './native-text-selection';
import {createNativeTableKeyboardExit} from './native-keyboard-exit';
import {createNativeTableTailOwner} from './native-tail-owner';
import {createTableKeyboardEntry} from './keyboard-entry';
import {createTableKeyboardBoundaries} from './keyboard-boundaries';
import {listTableBoundaryRows} from './list-boundary-spacing';
import {containerBlockFrame,containerPresentation,wrapContainerBlock,type ContainerFrame} from '../callout/container-surface';
import {admittedFragment} from './admitted-dom';
import {virtualTailState} from '../runtime/virtual-tail';
import {renderedSourcePointerPosition} from '../runtime/rendered-source-click';
import {selectionPointerPressed} from '../runtime/selection-session';

const controllers=new WeakMap<EditorView,Set<HtmlTableController>>();
const domControllers=new WeakMap<HTMLElement,HtmlTableController>();
const nativeContexts=new WeakMap<EditorView,{target:HTMLElement;point:{x:number;y:number}}>();
const actionLifecycles=new WeakMap<EditorView,symbol>();

function toolbarTarget(view:EditorView,context:HTMLElement|null):TableToolbarTarget|null {
	const active=view.dom.ownerDocument.activeElement as HTMLElement|null;
	const hit=context?.closest('td,th')?context:active;
	const controller=Array.from(controllers.get(view)??[]).find(candidate=>!!hit&&candidate.dom.contains(hit));
	if(controller){const table=controller.session.table;return {source:controller.session.target,element:controller.dom.querySelector('table')!,cell:hit?.closest<HTMLElement>('td,th')??null,rows:table.rows,columns:table.columns,firstColumn:controller.trackRectangle.left,lastColumn:controller.trackRectangle.right,html:controller};}
	const widget=hit?.closest<HTMLElement>('.cm-table-widget')??view.dom.querySelector<HTMLElement>('.cm-table-widget.has-focus');
	if(!widget||!view.dom.contains(widget))return null;
	const table=widget.querySelector<HTMLTableElement>('table');if(!table)return null;
	const position=view.posAtDOM(widget);const source=findEditableTableSources(view.state).find(source=>source.kind==='markdown'&&!source.container&&source.from<=position&&position<=source.to);if(!source)return null;
	const cell=hit?.closest<HTMLTableCellElement>('td,th')??table.querySelector<HTMLTableCellElement>('td,th');
	const selected=Array.from(table.querySelectorAll<HTMLTableCellElement>('.is-selected')).filter(element=>element.matches('td,th'));
	const columns=(selected.length?selected:cell?[cell]:[]).map(element=>element.cellIndex);
	return {source,element:table,cell,...markdownDimensions(source.source),firstColumn:columns.length?Math.min(...columns):0,lastColumn:columns.length?Math.max(...columns):0};
}

class TableWidget extends WidgetType {
	constructor(readonly session:TableEditSession,readonly options:TableEditingOptions,readonly frame:ContainerFrame|null){super();}
	eq(other:TableWidget):boolean{return this.session.target.from===other.session.target.from&&this.session.target.source===other.session.target.source&&this.session.target.container?.rawSource===other.session.target.container?.rawSource&&this.session.target.container?.kind===other.session.target.container?.kind&&this.session.target.container?.depth===other.session.target.container?.depth&&this.session.target.container?.task===other.session.target.container?.task&&this.frame?.key===other.frame?.key;}
	private listStyle(root:HTMLElement):void {
		const container=this.session.target.container;if(container?.kind!=='list')return;
		root.style.setProperty('--paraflow-table-list-depth',String(container.depth-1));
		root.style.setProperty('--paraflow-table-list-hanging',container.task?'0px':'.625em');
	}
	toDOM(view:EditorView):HTMLElement {
		const controller=new HtmlTableController(view,this.session,this.options);let set=controllers.get(view);if(!set){set=new Set();controllers.set(view,set);}set.add(controller);
		let root=wrapContainerBlock(view,controller.dom,this.frame);
		const container=this.session.target.container;
		if(container?.kind==='list'){
			root=view.dom.ownerDocument.createElement('div');root.className='paraflow-list-table-container';root.contentEditable='false';
			this.listStyle(root);root.append(controller.dom);
		}
		domControllers.set(root,controller);return root;
	}
	updateDOM(dom:HTMLElement,view:EditorView):boolean {
		if(dom.dataset.paraflowContainerFrame!==this.frame?.key)return false;
		if(dom.classList.contains('paraflow-list-table-container')!==(this.session.target.container?.kind==='list'))return false;
		this.listStyle(dom);
		const controller=domControllers.get(dom);if(!controller||controller.view!==view)return false;controller.update(this.session);return true;
	}
	destroy(dom:HTMLElement):void {
		const controller=domControllers.get(dom);if(!controller)return;controller.destroy();controllers.get(controller.view)?.delete(controller);domControllers.delete(dom);
	}
	ignoreEvent():boolean{return true;}
}

export function createTableEditingExtension(options:TableEditingOptions):Extension {
	const activation=StateEffect.define<{active:boolean;containers:boolean}>();
	const build=(state:EditorState,tables:readonly TableSource[],active:boolean,containers:boolean,previous:ReadonlyMap<string,HtmlTable>)=>{
		const models=new Map<string,HtmlTable>();
		if(!active)return {decorations:Decoration.none,models};const ranges:Range<Decoration>[]=[];
		for(const table of tables){if(table.container?table.container.kind==='quote'&&!containers:table.kind!=='html')continue;
			try{const key=table.kind+':'+table.source,session=new TableEditSession(table,table.to,models.get(key)??previous.get(key)),edge=state.field(virtualTailState,false);
				models.set(key,session.envelope);
				const before=!!edge&&edge.side==='before'&&!table.container&&!state.sliceDoc(0,table.from).trim();
				const after=!!edge&&edge.side!=='before'&&!table.container&&!state.sliceDoc(table.to).trim();
				ranges.push(Decoration.replace({block:true,...(before?{inclusiveStart:false}:{}),...(after?{inclusiveEnd:false}:{}),widget:new TableWidget(session,options,containerBlockFrame(state,table.from,table.to))}).range(table.from,table.to));}
			catch{/* Unsupported HTML retains the native/source editor; commands report its exact reason. */}
		}
		for(const [from,edge] of listTableBoundaryRows(state,tables))ranges.push(Decoration.line({class:'paraflow-block-boundary-gap',attributes:{'data-paraflow-before':edge.before,'data-paraflow-after':edge.after}}).range(from));
		return {decorations:Decoration.set(ranges,true),models};
	};
	const field=StateField.define({
		create(state){return {tables:findEditableTableSources(state),active:false,containers:false,decorations:Decoration.none,models:new Map<string,HtmlTable>()};},
		update(value,tr){const active=tr.effects.find(effect=>effect.is(activation))?.value;
			const tables=findEditableTableSources(tr.state);
			if(tables===value.tables&&active===undefined&&!tr.reconfigured&&tr.startState.field(virtualTailState,false)===tr.state.field(virtualTailState,false))return value;
			const enabled=active?.active??value.active,containers=active?.containers??value.containers;
			return {tables,active:enabled,containers,...build(tr.state,tables,enabled,containers,value.models)};
		},provide:field=>Prec.highest(EditorView.decorations.from(field,value=>value.decorations)),
	});
	return [tableFocusOwner.of(view=>options.isActive(view)&&options.isActiveView?.(view)!==false),EditorView.editorAttributes.of(view=>({class:hasTableActivationRequest(view)?'paraflow-table-focus-pending':''})),EditorView.baseTheme({'&.paraflow-table-focus-pending > .cm-scroller .cm-cursorLayer':{visibility:'hidden'},'&.paraflow-table-focus-pending > .cm-scroller .cm-content':{caretColor:'transparent'},'.cm-content > .paraflow-list-table-container':{boxSizing:'border-box',
		paddingInlineStart:'calc(var(--paraflow-live-list-base-indent, .5em) + var(--paraflow-table-list-depth) * var(--paraflow-live-list-indent, 30px) + var(--paraflow-live-list-content-offset, .75em) + var(--paraflow-table-list-hanging))'},
		'.paraflow-list-table-container > .paraflow-html-table-editor':{marginBlock:'0'}}),
		createNativeTableTailOwner(options),createNativeTableKeyboardExit(options),createTableKeyboardBoundaries(options,(view,cell)=>{
			const controller=Array.from(controllers.get(view)??[]).find(candidate=>candidate.dom.contains(cell));
			if(controller){const removed=controller.session.table.rows===1;controller.deleteCurrent('row',true);if(removed)view.focus();return true;}
			const target=NativeTableTarget.fromView(view,cell,false);if(!target)return false;
			const row=(cell.parentElement as HTMLTableRowElement).rowIndex;
			const next=deleteMarkdownTracks(target.session.target.source,'row',row,row);
			let focus;
			if(next){
				const session=new TableEditSession({...target.session.target,source:next}),position={row:Math.min(row,session.table.rows-1),column:cell.cellIndex};
				const model=session.table.cells.find(candidate=>candidate.row===position.row&&candidate.column===position.column)!;
				focus={cell:position,from:0,to:0,text:admittedFragment(view.dom.ownerDocument,model.html).textContent??''};
			}
			target.replaceSource(next,{kind:'delete',index:row,count:1},focus);if(!next)view.focus();return true;
		},(view,cell)=>{
			const controller=Array.from(controllers.get(view)??[]).find(candidate=>candidate.dom.contains(cell));
			if(controller){controller.insertRowAfter(Number(cell.dataset.pfRow));return true;}
			const target=toolbarTarget(view,cell);if(!target)return false;
			const row=(cell.parentElement as HTMLTableRowElement).rowIndex+1;
			const to=Math.min(target.source.to,view.state.doc.line(view.state.doc.lineAt(target.source.from).number+cell.closest('table')!.rows.length).to);
			// Native activation pads new cells; emit that layout in the isolated row edit.
			const next=formatMarkdownTable(insertMarkdownTrack(view.state.doc.sliceString(target.source.from,to),'row',row));
			NativeTableTarget.replaceMarkdownSource(view,target.source,cell,next,{cell:{row,column:0},from:0,to:0,text:''},to);return true;
		}),createTableKeyboardEntry(options),field,ViewPlugin.define(view=>{
		let destroyed=false;let pending=false;
		let lifecycle=Symbol();actionLifecycles.set(view,lifecycle);
		const nativeControls=new NativeTableControls(view.dom,()=>options.getHideAddControls?.()??true,()=>options.isActive(view)&&options.isActiveView?.(view)!==false);
		const nativeDragPreview=new NativeTableDragPreview(view,()=>options.isActive(view)&&options.isActiveView?.(view)!==false);
		const nativeTextSelection=new NativeTableTextSelection(view,()=>options.isActive(view)&&options.isActiveView?.(view)!==false,()=>!options.isActive(view)&&options.isActiveView?.(view)!==false&&(options.isSourceMode?.(view)??true));
		const toolbar=new TableFocusToolbar(view,options,context=>toolbarTarget(view,context));
		const restoreHtml=(from:number,bookmark:TableFocusBookmark)=>{
			const controller=Array.from(controllers.get(view)??[]).find(controller=>controller.session.target.from===from);if(!controller)return false;
			const rectangle=bookmark.rectangle;if(rectangle)controller.select({row:rectangle.top,column:rectangle.left},{row:rectangle.bottom,column:rectangle.right});
			controller.restoreTextSelection(bookmark);return true;
		};
		const restoreSourceSelection=()=>Array.from(controllers.get(view)??[]).some(controller=>controller.restoreSourceSelection());
		// Source gestures focus the outer editor before publishing their range; the prior cell cannot reclaim it.
		const sourceGesture=()=>renderedSourcePointerPosition(view)!==null||selectionPointerPressed(view.state);
		// Keep the semantic HTML destination through the host's final mode-focus call.
		// eslint-disable-next-line @typescript-eslint/unbound-method -- restored verbatim and invoked with its original view receiver.
		const originalFocus=view.focus,focusWasOwn=Object.prototype.hasOwnProperty.call(view,'focus'),focus=()=>{if(!sourceGesture()&&options.isActive(view)&&options.isActiveView?.(view)!==false&&(resumeHtmlActivationFocus(view,restoreHtml)||restoreSourceSelection()))return;originalFocus.call(view);};view.focus=focus;
		// Native cell editors can stop bubbling before the root editor sees the menu.
		const captureContext=(event:MouseEvent)=>{
			nativeContexts.delete(view);
			const target=event.target as HTMLElement|null;
			if(!options.isActive(view)||!target||target.nodeType!==1)return;
			nativeContexts.set(view,{target,point:{x:event.clientX,y:event.clientY}});
			if(target.closest('.cm-table-widget td,.cm-table-widget th')){
				try{if(showCurrentTableMenu(view,options,{x:event.clientX,y:event.clientY},true)){event.preventDefault();event.stopPropagation();}}
				catch(error){options.notify(error instanceof Error?error.message:String(error));}
			}
		};
		view.dom.addEventListener('contextmenu',captureContext,true);
		const refresh=()=>{
			if(pending||destroyed)return;pending=true;
			queueMicrotask(()=>{
				pending=false;if(destroyed)return;
				const active=options.isActive(view),containers=view.state.facet(containerPresentation).some(owner=>owner.isActive(view)&&owner.isActiveState?.(view.state)!==false);
				nativeControls.update(active);for(const controller of controllers.get(view)??[])controller.refreshOptions();
				const previous=view.state.field(field);if(active!==previous.active||containers!==previous.containers)view.dispatch({effects:activation.of({active,containers})});
				if(hasTableFocusRequest(view)){
					const restored=restoreTableFocus(view,active&&options.isActiveView?.(view)!==false,restoreHtml);
					if(restored)toolbar.schedule();
				}
				else if(active&&!previous.active&&view.hasFocus&&options.isActiveView?.(view)!==false)restoreSourceSelection();
				nativeTextSelection.refresh();
			});
		};
		const cancelFocus=(event:Event)=>{
			const target=event.target as HTMLElement;
			if(isTableMenuTarget(target))return;
			if(event.type==='focusin'&&(target===view.dom.ownerDocument.body||target===view.contentDOM))return;
			if(target.closest?.('.paraflow-table-toolbar,.paraflow-table-menu,.paraflow-table-size-popup,.modal,.modal-container'))return;
			clearTableFocus(view);
		};
		const cancelActivation=()=>{clearTableActivationResume(view);if(hasTableActivationRequest(view))clearTableFocus(view);};
		view.dom.ownerDocument.addEventListener('pointerdown',cancelFocus,true);view.dom.ownerDocument.addEventListener('focusin',cancelFocus,true);view.dom.addEventListener('keydown',cancelActivation,true);
		const observer=new view.dom.ownerDocument.defaultView!.MutationObserver(refresh);observer.observe(view.contentDOM,{childList:true,subtree:true});
		refresh();return {update(update){
			if(update.docChanged||update.selectionSet)clearTableActivationResume(view);
			const active=options.isActive(view);
			if(!active)actionLifecycles.set(view,lifecycle=Symbol());
			if(update.docChanged||!active){clearTableActions(view);nativeContexts.delete(view);toolbar.hide();for(const controller of controllers.get(view)??[])controller.clearPreview();}toolbar.schedule();refresh();
			if(update.transactions.some(transaction=>transaction.docChanged&&(transaction.isUserEvent('undo')||transaction.isUserEvent('redo')))){
				const state=view.state;
				// Host display effects may create another state before the restored widget receives focus.
				queueMicrotask(()=>{if(!destroyed&&view.state.doc===state.doc&&view.state.selection.eq(state.selection)&&options.isActive(view)&&options.isActiveView?.(view)!==false&&!sourceGesture())restoreSourceSelection();});
			}
			if(update.selectionSet||!active)for(const controller of controllers.get(view)??[]){const selection=view.state.selection.main,target=controller.session.target;if(!active||selection.from<target.from||selection.to>target.to)controller.releaseSelection();}
			nativeDragPreview.refreshOwnership();
		},destroy(){destroyed=true;clearTableFocus(view);if(view.focus===focus){if(focusWasOwn)view.focus=originalFocus;else Reflect.deleteProperty(view,'focus');}view.dom.ownerDocument.removeEventListener('pointerdown',cancelFocus,true);view.dom.ownerDocument.removeEventListener('focusin',cancelFocus,true);view.dom.removeEventListener('keydown',cancelActivation,true);if(actionLifecycles.get(view)===lifecycle)actionLifecycles.delete(view);observer.disconnect();nativeControls.destroy();nativeDragPreview.destroy();nativeTextSelection.destroy();toolbar.destroy();view.dom.removeEventListener('contextmenu',captureContext,true);clearTableActions(view);for(const controller of controllers.get(view)??[])controller.destroy();controllers.delete(view);nativeContexts.delete(view);}};
	})];
}

export function canEditCurrentTable(view:EditorView,options:TableEditingOptions,fromContextMenu=false):boolean {
	if(!options.isActive(view))return false;
	if(fromContextMenu){
		const context=nativeContexts.get(view);
		if(!context||!view.dom.contains(context.target)||!context.target.closest('td,th'))return false;
		const position=view.posAtDOM(context.target.closest('.cm-table-widget')??context.target);
		return findEditableTableSources(view.state).some(table=>table.from<=position&&position<=table.to);
	}
	const source=findEditableTableSources(view.state);const position=view.state.selection.main.head;
	return source.some(table=>table.from<=position&&position<=table.to)||Array.from(controllers.get(view)??[]).some(controller=>controller.dom.contains(view.dom.ownerDocument.activeElement));
}

export function currentTableMergeActions(view:EditorView,options:TableEditingOptions):TableMenuItem[] {
	const lifecycle=actionLifecycles.get(view);
	if(!lifecycle||!canEditCurrentTable(view,options,true))return [];
	const context=nativeContexts.get(view)!;
	try{
		const target=Array.from(controllers.get(view)??[]).find(controller=>controller.dom.contains(context.target))??NativeTableTarget.fromView(view,context.target,false);
		return target?tableMergeActions(target,options,()=>{if(actionLifecycles.get(view)!==lifecycle)throw new Error('表格编辑目标已变化，请重新选择。');}):[];
	}catch(error){if(error instanceof TableSerializationError)return [];throw error;}
}

export function currentTableSourceActions(view:EditorView,options:TableEditingOptions):TableMenuItem[] {
	const lifecycle=actionLifecycles.get(view),context=nativeContexts.get(view);
	if(!lifecycle||!context||!canEditCurrentTable(view,options,true))return [];
	const controller=Array.from(controllers.get(view)??[]).find(controller=>controller.dom.contains(context.target));
	const position=controller?.session.target.from??view.posAtDOM(context.target.closest('.cm-table-widget')??context.target);
	const source=findEditableTableSources(view.state).find(source=>source.from<=position&&position<=source.to)!;
	return tableSourceActions(view,source,options,context.target.closest('td,th'),controller,()=>{if(actionLifecycles.get(view)!==lifecycle)throw new Error('表格编辑目标已变化，请重新选择。');});
}

export function showCurrentTableMenu(view:EditorView,options:TableEditingOptions,point?:{x:number;y:number},fromContextMenu=false):boolean {
	if(!options.isActive(view))return false;
	if(fromContextMenu&&!canEditCurrentTable(view,options,true))return false;
	const position=view.state.selection.main.head;
	const context=fromContextMenu?nativeContexts.get(view):undefined;
	const controller=context?Array.from(controllers.get(view)??[]).find(controller=>controller.dom.contains(context.target)):
		Array.from(controllers.get(view)??[]).find(controller=>controller.dom.contains(view.dom.ownerDocument.activeElement))??Array.from(controllers.get(view)??[]).find(controller=>controller.session.target.from<=position&&position<=controller.session.target.to);
	const box=view.dom.getBoundingClientRect();const menuPoint=point??context?.point??{x:box.left+24,y:box.top+24};
	if(controller){controller.showContextMenu(menuPoint);return true;}
	let target:NativeTableTarget|null;
	try{target=NativeTableTarget.fromView(view,context?.target??null);}
	catch(error){
		if(!(error instanceof TableSerializationError))throw error;
		const cell=context?.target.closest<HTMLElement>('td,th')??null;
		const anchor=cell?view.posAtDOM(cell.closest('.cm-table-widget')??cell):position;
		const source=findEditableTableSources(view.state).find(source=>source.from<=anchor&&anchor<=source.to);
		if(!source)return false;
		options.showMenu!(view.dom.ownerDocument,menuPoint,nativeSourceMenu(view,source,cell,options));return true;
	}
	if(!target)return false;
	showTableContextMenu(target,options,menuPoint);return true;
}

export async function insertNewTable(view:EditorView,options:TableEditingOptions):Promise<void> {
	if(!options.isActive(view))return;
	const before=view.state.doc;const selection=view.state.selection.main;const dimensions=await options.requestDimensions();if(!dimensions)return;
	if(view.state.doc!==before||!options.isActive(view))throw new Error('文档已变化，请重新选择插入位置。');
	const table=gridToHtml(createTable(dimensions.rows,dimensions.columns));
	const prefix=selection.from>0?'\n\n':'';const suffix=selection.to<view.state.doc.length?'\n\n':'';
	view.dispatch({changes:{from:selection.from,to:selection.to,insert:prefix+table+suffix},selection:{anchor:selection.from+prefix.length},annotations:isolateHistory.of('full')});
}

export type {TableEditingOptions,TableValueRequest} from './editing-types';
