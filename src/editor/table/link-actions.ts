import type {EditorView} from '@codemirror/view';
import {isExternalLink,type LinkOpenIntent} from '../../links/intent';
import type {TableEditingOptions} from './editing-types';
import type {TableMenuItem} from './popup';

/** Read the event target before a table action changes focus or selection. */
export function tableLinkTarget(element:Element|null):string|null {
	const anchor=element?.closest('a[href],a[data-href]');
	return anchor?.getAttribute('data-href')??anchor?.getAttribute('href')??null;
}

export function openTableLink(view:EditorView,target:string,intent:LinkOpenIntent,options:TableEditingOptions):void {
	if(!options.openWikiLink)throw new Error('链接导航未连接到宿主。');
	try{void Promise.resolve(options.openWikiLink(view,target,intent)).catch(error=>options.notify(error instanceof Error?error.message:String(error)));}
	catch(error){options.notify(error instanceof Error?error.message:String(error));}
}

export function tableLinkMenuItems(view:EditorView,target:string|null,options:TableEditingOptions):TableMenuItem[] {
	if(target===null)return [];
	const navigate=options.captureLinkNavigation?.(view,target);
	const open=(intent:LinkOpenIntent)=>{
		if(!navigate){openTableLink(view,target,intent,options);return;}
		try{void Promise.resolve(navigate(intent)).catch(error=>options.notify(error instanceof Error?error.message:String(error)));}
		catch(error){options.notify(error instanceof Error?error.message:String(error));}
	};
	if(isExternalLink(target))return [{label:'打开链接',icon:'external-link',run:()=>open('current')}];
	return [
		{label:'在当前标签页打开',icon:'file',run:()=>open('current')},
		{label:'在新的标签页打开',icon:'file-plus',run:()=>open('tab')},
	];
}
