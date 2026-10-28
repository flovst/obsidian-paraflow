import {NativeTableTarget} from './native-target';
import type {EditorView} from '@codemirror/view';
import {type TableSource} from './edit-session';
import type {TableEditingOptions} from './editing-types';
import {captureTableActionTarget,type TableActionTarget} from './action-target';
import {alignMarkdownColumns,markdownColumnAlignments,replaceTableSource,resizeHtmlTable,resizeMarkdownTable} from './toolbar-source';
import {toggleCellAlignment,toggleVerticalAlignment} from './formatting';
import {beginTableActions,clearTableActions} from './table-actions';
import {showTableContextMenu} from './html-context-menu';
import {isTableMenuTarget} from './native-menu';
import {TableSerializationError} from './serialization';
import {nativeSourceMenu} from './native-source-menu';
import {showTableSizePopup} from './size-popup';
import {tableConversionAction} from './conversion-action';

const toolbars=new Set<TableFocusToolbar>();
export function refreshTableToolbarOwnership():void {for(const toolbar of toolbars)toolbar.refreshOwnership();}

const toolbarIcons={
	grid:'M2 2H14V14H2Z M2 6H14 M2 10H14 M6 2V14 M10 2V14',
	left:'M2 2H14 M2 6H10 M2 10H14 M2 14H10',
	center:'M2 2H14 M4 6H12 M2 10H14 M4 14H12',
	right:'M2 2H14 M6 6H14 M2 10H14 M6 14H14',
	top:'M2 2H14 M4 5H12 M4 8H12 M4 11H12 M8 14V5',
	middle:'M2 8H14 M4 3H12 M4 5H12 M4 11H12 M4 13H12',
	bottom:'M2 14H14 M4 5H12 M4 8H12 M4 11H12 M8 2V11',
	more:'M3 8H3.01 M8 8H8.01 M13 8H13.01',
	delete:'M2 4H14 M6 4V2H10V4 M4 4L5 14H11L12 4 M7 7V11 M9 7V11',
} as const;

function toolbarIcon(doc:Document,name:keyof typeof toolbarIcons):SVGSVGElement {
	const icon=doc.createElementNS('http://www.w3.org/2000/svg','svg');
	icon.setAttribute('viewBox','0 0 16 16');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
	icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.25');
	icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');
	if(name==='more')for(const x of [3,8,13]){const dot=doc.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx',String(x));dot.setAttribute('cy','8');dot.setAttribute('r','1.7');dot.setAttribute('fill','currentColor');dot.setAttribute('stroke','none');icon.append(dot);}
	else {const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',toolbarIcons[name]);icon.append(path);}
	return icon;
}

export interface TableToolbarTarget {
	readonly source:TableSource;
	readonly element:HTMLElement;
	readonly cell:HTMLElement|null;
	readonly rows:number;
	readonly columns:number;
	readonly firstColumn:number;
	readonly lastColumn:number;
	readonly html?:TableActionTarget;
}

/** A body-level overlay leaves native table layout, cell editors and drag handles untouched. */
export class TableFocusToolbar {
	private dom:HTMLElement|null=null;
	private target:TableToolbarTarget|null=null;
	private popup:ReturnType<typeof showTableSizePopup>|null=null;
	private sourceMenu:{close:()=>void}|null=null;
	private queued=false;
	private queuedContext:HTMLElement|null=null;
	private pointerCell:HTMLElement|null=null;
	private destroyed=false;
	private resizeObserver:ResizeObserver|null=null;
	private observed:HTMLElement[]=[];
	private positioningFrame:number|null=null;
	constructor(private readonly view:EditorView,private readonly options:TableEditingOptions,private readonly resolve:(context:HTMLElement|null)=>TableToolbarTarget|null){
		toolbars.add(this);
		view.dom.addEventListener('focusin',this.focus,true);view.dom.addEventListener('pointerdown',this.pointerDown,true);
		view.dom.ownerDocument.addEventListener('pointerup',this.pointerEnd,true);view.dom.ownerDocument.addEventListener('pointercancel',this.pointerEnd,true);
		view.dom.ownerDocument.addEventListener('focusin',this.outside,true);view.dom.ownerDocument.addEventListener('pointerdown',this.outside,true);
		view.dom.ownerDocument.addEventListener('scroll',this.position,true);view.dom.ownerDocument.defaultView!.addEventListener('resize',this.position);
	}
	private focus=(event:Event)=>{const context=event.target as HTMLElement;this.schedule(context);};
	private pointerDown=(event:PointerEvent)=>{
		if(event.button!==0)return;
		this.pointerCell=(event.target as HTMLElement).closest<HTMLElement>('td,th');
		if(this.pointerCell)this.schedule(this.pointerCell);
	};
	private pointerEnd=(event:PointerEvent)=>{
		const cell=this.pointerCell;this.pointerCell=null;
		const target=event.target as HTMLElement;
		if(event.type==='pointercancel'){if(cell)this.hide();return;}
		if(this.view.dom.contains(target))this.schedule(target);else if(cell)this.hide();
	};
	private outside=(event:Event)=>{const node=event.target as Node;if(!isTableMenuTarget(node)&&!this.view.dom.contains(node)&&!this.dom?.contains(node)&&!this.popup?.dom.contains(node)&&!(node as HTMLElement).closest?.('.paraflow-table-menu,.modal-container')){clearTableActions(this.view);this.hide();}};
	schedule(context:HTMLElement|null=null):void {
		if(this.destroyed)return;
		// Native tables focus TABLE between pointerdown and pointerup; retain the hit cell.
		if(this.pointerCell)this.queuedContext=this.pointerCell;
		else if(context?.closest('td,th')||!this.queuedContext)this.queuedContext=context;
		if(this.queued)return;this.queued=true;queueMicrotask(()=>{if(!this.queued)return;const latest=this.queuedContext;this.queued=false;this.queuedContext=null;if(!this.destroyed)this.refresh(latest);});
	}
	refresh(context:HTMLElement|null=null):void {
		if(!this.refreshOwnership())return;
		if(this.popup)return;
		if(!this.options.isActive(this.view)){this.hide();return;}
		const target=this.resolve(this.pointerCell??context);if(!target){this.hide();return;}this.target=target;
		if(!this.dom)this.create();
		const palette=this.view.dom.ownerDocument.defaultView!.getComputedStyle(target.element);
		for(const token of ['--interactive-accent','--background-modifier-hover','--background-modifier-border','--text-normal','--text-muted']) {
			this.dom!.style.setProperty(token,palette.getPropertyValue(token));
		}
		this.observeGeometry(target.element);
		this.dom!.querySelector<HTMLButtonElement>('[data-pf-table-size]')!.setAttribute('aria-label',`调整表格行列数（${target.rows} 行 × ${target.columns} 列）`);
		const sourceButton=this.dom!.querySelector<HTMLButtonElement>('[data-pf-table-source-type]')!,sourceType=target.source.kind==='markdown'?'Markdown':'HTML';
		sourceButton.textContent=sourceType;sourceButton.setAttribute('aria-label',`表格源码类型：${sourceType}`);
		const selected=target.source.kind==='html'?target.html!.session.table.cells.filter(cell=>cell.column<=target.lastColumn&&cell.column+cell.columnSpan>target.firstColumn):[];
		const styles=(property:'text-align'|'vertical-align')=>selected.map(cell=>cell.style[property]?.replace(/\s*!important\s*$/iu,'').trim().toLowerCase()??null);
		this.alignmentState('[data-pf-alignment]','pfAlignment',target.source.kind==='html'?styles('text-align'):markdownColumnAlignments(target.source.source,target.firstColumn,target.lastColumn));
		this.alignmentState('[data-pf-vertical-alignment]','pfVerticalAlignment',styles('vertical-align'));
		this.position();
	}
	private alignmentState(selector:string,key:string,values:readonly (string|null)[]):void {
		for(const button of this.dom!.querySelectorAll<HTMLElement>(selector)){
			const matches=values.filter(value=>value===button.dataset[key]).length;
			button.setAttribute('aria-pressed',matches===0?'false':matches===values.length?'true':'mixed');
		}
	}
	refreshOwnership():boolean {
		if(this.options.isActiveView?.(this.view)!==false)return true;
		clearTableActions(this.view);this.hide();return false;
	}
	private run(action:(target:TableToolbarTarget)=>void):void {
		const target=this.target;if(!target)return;
		try{this.check(target);action(target);}catch(error){this.options.notify(error instanceof Error?error.message:String(error));}
	}
	private check(target:TableToolbarTarget):void {
		if(!this.options.isActive(this.view)||this.options.isActiveView?.(this.view)===false)throw new Error('表格操作目标已变化，请重新选择。');
		replaceTableSource(this.view.state,target.source,target.source.source);
	}
	private showSourceMenu(target:TableToolbarTarget,button:HTMLButtonElement):void {
		const doc=this.view.dom.ownerDocument,box=button.getBoundingClientRect(),label=target.source.kind==='markdown'?'转换为 HTML 表格':'转换为 Markdown 格式';
		let actionTarget:TableActionTarget;
		try{actionTarget=captureTableActionTarget(target.html??NativeTableTarget.fromView(this.view,target.cell,false)!);}
		catch(error){if(!(error instanceof TableSerializationError))throw error;clearTableActions(this.view);this.sourceMenu=this.options.showMenu!(doc,{x:box.left,y:box.bottom},[{label,disabled:true,disabledReason:error.message}],()=>{this.sourceMenu=null;button.setAttribute('aria-expanded','false');},this.options.renderMenuIcon);button.setAttribute('aria-expanded','true');return;}
		const lifecycle=beginTableActions(actionTarget);
		const check=()=>{
			if(this.destroyed||lifecycle.cancelled)throw new Error('表格操作目标已变化，请重新选择。');
			if(this.view.state.readOnly)throw new Error('文档只读');
			this.check(target);
		};
		const convert=tableConversionAction(actionTarget,this.options,check);
		this.sourceMenu=this.options.showMenu!(doc,{x:box.left,y:box.bottom},[{label,disabled:this.view.state.readOnly,disabledReason:this.view.state.readOnly?'文档只读':undefined,run:()=>{void convert().catch(error=>this.options.notify(error instanceof Error?error.message:String(error)));}}],()=>{this.sourceMenu=null;button.setAttribute('aria-expanded','false');},this.options.renderMenuIcon);
		lifecycle.close=this.sourceMenu.close;button.setAttribute('aria-expanded','true');
	}
	private create():void {
		const doc=this.view.dom.ownerDocument;const root=doc.createElement('div');root.className='paraflow-table-toolbar';root.setAttribute('role','toolbar');root.setAttribute('aria-label','表格工具栏');root.setAttribute('contenteditable','false');
		const start=doc.createElement('div');start.className='paraflow-table-toolbar-start';root.append(start);
		const makeGroup=(parent:HTMLElement,name:string,label:string)=>{const group=doc.createElement('div');group.className='paraflow-table-toolbar-group';group.dataset.pfToolbarGroup=name;group.setAttribute('role','group');group.setAttribute('aria-label',label);parent.append(group);return group;};
		let group=makeGroup(start,'size','表格大小');
		const button=(label:string,icon:keyof typeof toolbarIcons|null,action:(target:TableToolbarTarget)=>void)=>{const element=doc.createElement('button');element.type='button';element.setAttribute('aria-label',label);if(icon)element.append(toolbarIcon(doc,icon));element.onmousedown=event=>event.preventDefault();element.onclick=()=>this.run(action);group.append(element);return element;};
		button('调整表格行列数','grid',target=>{
			const box=root.getBoundingClientRect();this.popup=showTableSizePopup(doc,{x:box.left,y:box.bottom},target,(rows,columns)=>{
				this.check(target);if(rows===target.rows&&columns===target.columns)return;
				if(target.source.kind==='html')target.html!.commit(resizeHtmlTable(target.html!.session.table,rows,columns),true,{kind:'resize',rows});
				else {const source=resizeMarkdownTable(target.source.source,rows,columns);if(target.html)target.html.replaceSource(source,{kind:'resize',rows});else NativeTableTarget.replaceMarkdownSource(this.view,target.source,target.cell,source);}
			},()=>{this.popup=null;this.schedule();});
			const input=this.popup.dom.querySelector('input')!;input.focus();input.select();
		}).dataset.pfTableSize='';
		group=makeGroup(start,'horizontal','列水平对齐');
		for(const [alignment,label] of [['left','列靠左对齐'],['center','列居中对齐'],['right','列靠右对齐']] as const)button(label,alignment,target=>{
			if(target.source.kind==='html'){const table=target.html!.session.table;const positions=table.cells.filter(cell=>cell.column<=target.lastColumn&&cell.column+cell.columnSpan>target.firstColumn);target.html!.commit(toggleCellAlignment(table,positions,'text-align',alignment),false);}
			else {const source=alignMarkdownColumns(target.source.source,target.firstColumn,target.lastColumn,alignment);if(target.html)target.html.replaceSource(source);else NativeTableTarget.replaceMarkdownSource(this.view,target.source,target.cell,source);}
		}).dataset.pfAlignment=alignment;
		group=makeGroup(start,'vertical','列垂直对齐');
		for(const [alignment,label] of [['top','顶端对齐'],['middle','垂直居中'],['bottom','底端对齐']] as const){
			const control=button(label,alignment,target=>{
				const actionTarget=target.html??NativeTableTarget.fromView(this.view,target.cell,false)!;const table=actionTarget.session.table;
				const positions=table.cells.filter(cell=>cell.column<=target.lastColumn&&cell.column+cell.columnSpan>target.firstColumn);
				const next=toggleVerticalAlignment(table,positions,alignment);
				actionTarget.commit(next,false);
			});control.dataset.pfVerticalAlignment=alignment;
		}
		group=makeGroup(root,'actions','表格操作');
		const source=button('表格源码类型',null,target=>this.showSourceMenu(target,source));source.dataset.pfTableSourceType='';source.setAttribute('aria-haspopup','menu');source.setAttribute('aria-expanded','false');
		const more=button('更多表格操作','more',target=>{
			const box=more.getBoundingClientRect();const point={x:box.right,y:box.top};
			try{const actionTarget=target.html??NativeTableTarget.fromView(this.view,target.cell);if(actionTarget)showTableContextMenu(actionTarget,this.options,point);}
			catch(error){if(!(error instanceof TableSerializationError))throw error;this.options.showMenu!(doc,point,nativeSourceMenu(this.view,target.source,target.cell,this.options));}
		});
		button('删除表格','delete',target=>{if(target.html)target.html.commit(null,true);else this.view.dispatch(replaceTableSource(this.view.state,target.source,''));this.hide();});
		this.dom=root;doc.body.append(root);
	}
	private clippingAncestors(element:HTMLElement):HTMLElement[] {
		const ancestors:HTMLElement[]=[];const win=element.ownerDocument.defaultView!;
		for(let parent=element.parentElement;parent&&parent!==this.view.dom;parent=parent.parentElement){
			if(parent===this.view.scrollDOM)continue;
			if(/^(?:auto|scroll|hidden|clip|overlay)$/u.test(win.getComputedStyle(parent).overflowX))ancestors.push(parent);
		}
		return ancestors;
	}
	private observeGeometry(element:HTMLElement):void {
		const win=element.ownerDocument.defaultView!;if(!win.ResizeObserver)return;
		const observed=[element,this.view.scrollDOM,...this.clippingAncestors(element)];
		if(observed.length===this.observed.length&&observed.every((target,index)=>target===this.observed[index]))return;
		this.resizeObserver??=new win.ResizeObserver(this.schedulePosition);this.resizeObserver.disconnect();this.observed=observed;
		for(const target of observed)this.resizeObserver.observe(target);
	}
	private schedulePosition=():void=>{
		if(this.positioningFrame!==null||this.destroyed||!this.dom)return;
		this.positioningFrame=this.view.dom.ownerDocument.defaultView!.requestAnimationFrame(()=>{this.positioningFrame=null;this.position();});
	};
	private position=():void=>{
		if(!this.refreshOwnership())return;
		if(!this.dom||!this.target)return;if(!this.target.element.isConnected){this.hide();return;}
		const table=this.target.element.getBoundingClientRect();const viewport=this.view.scrollDOM.getBoundingClientRect();
		this.dom.hidden=table.bottom<viewport.top||table.top>viewport.bottom;
		if(this.dom.hidden)return;
		let left=Math.max(viewport.left,table.left),right=Math.min(table.right,viewport.right);
		for(const ancestor of [this.view.scrollDOM,...this.clippingAncestors(this.target.element)]){
			const box=ancestor.getBoundingClientRect();const scale=ancestor.offsetWidth?box.width/ancestor.offsetWidth:1;
			const clipLeft=box.left+ancestor.clientLeft*scale;const clipRight=ancestor.offsetWidth?clipLeft+ancestor.clientWidth*scale:box.right;
			left=Math.max(left,clipLeft);right=Math.min(right,clipRight);
		}
		if(right<=left){this.dom.hidden=true;return;}
		this.dom.style.width=`${Math.max(0,right-left)}px`;this.dom.style.left=`${left}px`;
		this.dom.style.setProperty('--pf-toolbar-width',`${Math.max(0,right-left)}px`);
		const box=this.dom.getBoundingClientRect();
		this.dom.style.top=`${table.top-box.height}px`;
		this.dom.hidden=table.top-box.height<viewport.top;
	};
	hide():void {this.pointerCell=null;this.queued=false;this.queuedContext=null;this.sourceMenu?.close();this.sourceMenu=null;this.popup?.close();this.popup=null;this.resizeObserver?.disconnect();this.observed=[];if(this.positioningFrame!==null)this.view.dom.ownerDocument.defaultView!.cancelAnimationFrame(this.positioningFrame);this.positioningFrame=null;this.dom?.remove();this.dom=null;this.target=null;}
	destroy():void {
		this.destroyed=true;toolbars.delete(this);this.hide();const doc=this.view.dom.ownerDocument;
		this.view.dom.removeEventListener('focusin',this.focus,true);this.view.dom.removeEventListener('pointerdown',this.pointerDown,true);
		doc.removeEventListener('pointerup',this.pointerEnd,true);doc.removeEventListener('pointercancel',this.pointerEnd,true);
		doc.removeEventListener('focusin',this.outside,true);doc.removeEventListener('pointerdown',this.outside,true);doc.removeEventListener('scroll',this.position,true);doc.defaultView!.removeEventListener('resize',this.position);
	}
}
