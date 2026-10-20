import {ChangeSet,Compartment,EditorSelection,Facet,StateEffect,Text,Transaction,type Extension} from '@codemirror/state';
import {EditorView,ViewPlugin} from '@codemirror/view';

/** The native table cell still owns editing/history; its BR spelling remains editable. */
export const nativeCellSourceEditing=Facet.define<boolean,boolean>({combine:values=>values.some(Boolean)});
const nativeCellSourcePresentation=[nativeCellSourceEditing.of(true),EditorView.editorAttributes.of({class:'paraflow-native-cell-source'})];

export interface NativeSourceCell {
	readonly cm:EditorView;
	readonly cell:{readonly text:string;getAbsoluteOffsets():{textStart:number;textEnd:number}};
}

/** Native cells unescape table pipes. BR tags deliberately retain their source spelling. */
export function nativeCellSource(source:string,foldBreaks=false,decodePipes=true):{text:string;changes:ChangeSet} {
	const changes:{from:number;to:number;insert:string}[]=[];
	const code=Array.from(source.matchAll(/(`+)[^`]+\1/gu),match=>({from:match.index,to:match.index+match[0].length}));
	for(const match of source.matchAll(/\\+\||<br>/giu)){
		const from=match.index,to=from+match[0].length;
		if(match[0].endsWith('|')){if(decodePipes)changes.push({from,to:from+1,insert:''});}
		else if(foldBreaks&&!code.some(range=>range.from<=from&&to<=range.to))changes.push({from,to,insert:'\n'});
	}
	const changeSet=ChangeSet.of(changes,source.length);
	return {text:changeSet.apply(Text.of(source.split('\n'))).toString(),changes:changeSet};
}

export function createNativeCellSourceEditing(
	isActive:(view:EditorView)=>boolean,
	resolve:(view:EditorView)=>NativeSourceCell|null,
):Extension {
	return ViewPlugin.fromClass(class {
		private pending=false;
		private destroyed=false;
		private current:NativeSourceCell|null=null;
		private compartment:Compartment|null=null;
		private enabled=false;
		constructor(readonly view:EditorView){view.dom.addEventListener('focusin',this.schedule,true);view.dom.addEventListener('compositionend',this.schedule,true);this.schedule();}
		update():void {this.schedule();}
		private schedule=()=>{
			if(this.pending||this.destroyed)return;this.pending=true;
			queueMicrotask(()=>{this.pending=false;if(!this.destroyed)this.refresh();});
		};
		private refresh():void {
			const active=resolve(this.view),enabled=isActive(this.view);
			if(!active||active.cm.compositionStarted||active.cm.composing)return;
			if(this.current?.cm!==active.cm){this.restore();this.current=null;this.compartment=null;this.enabled=false;}
			if(!this.current&&!/<br[ \t]*\/?[ \t]*>/iu.test(active.cell.text))return;
			this.current=active;
			const decoded=nativeCellSource(active.cell.text,!enabled),offsets=active.cell.getAbsoluteOffsets();
			const selection=this.view.state.selection;
			if(!selection.ranges.every(range=>offsets.textStart<=range.from&&range.to<=offsets.textEnd))return;
			const mapped=EditorSelection.create(selection.ranges.map(range=>EditorSelection.range(
				decoded.changes.mapPos(range.anchor-offsets.textStart),decoded.changes.mapPos(range.head-offsets.textStart))),selection.mainIndex);
			const effects=[];
			if(!this.compartment&&enabled){this.compartment=new Compartment();effects.push(StateEffect.appendConfig.of(this.compartment.of(nativeCellSourcePresentation)));}
			else if(this.compartment&&enabled!==this.enabled)effects.push(this.compartment.reconfigure(enabled?nativeCellSourcePresentation:[]));
			this.enabled=enabled;
			if(active.cm.state.doc.toString()===decoded.text&&active.cm.state.selection.eq(mapped)&&!effects.length)return;
			active.cm.dispatch({changes:active.cm.state.doc.toString()===decoded.text?undefined:{from:0,to:active.cm.state.doc.length,insert:decoded.text},selection:mapped,effects,userEvent:'set',annotations:Transaction.addToHistory.of(false)});
		}
		private restore():void {
			if(!this.current||!this.compartment||!this.enabled)return;
			const {cm}=this.current,compartment=this.compartment;
			const finish=()=>{
				if(!cm.dom.isConnected)return;
				// Fold the live draft, never stale host text. A composition may commit after unload.
				const folded=nativeCellSource(cm.state.doc.toString(),true,false);
				cm.dispatch({changes:folded.changes,selection:cm.state.selection.map(folded.changes),effects:compartment.reconfigure([]),userEvent:'set',annotations:Transaction.addToHistory.of(false)});
			};
			if(cm.compositionStarted||cm.composing)cm.dom.addEventListener('compositionend',()=>queueMicrotask(finish),{once:true});
			else finish();
		}
		destroy():void {this.destroyed=true;this.view.dom.removeEventListener('focusin',this.schedule,true);this.view.dom.removeEventListener('compositionend',this.schedule,true);this.restore();}
	});
}
