import { createCodeBlockDisplay } from '../../display/code-blocks.js';
import type { CodeBlockOptions } from './model.js';

const CONTAINER_CODE='.cm-embed-block[contenteditable="false"] .markdown-rendered pre, .cm-embed-block.markdown-rendered[contenteditable="false"] pre';

export function createRenderedContainerCodeBlocks(root: HTMLElement, config: {
	isActive: ()=>boolean;
	getOptions: ()=>CodeBlockOptions;
}): {refresh():void; destroy():void} {
	const ownerWindow=root.ownerDocument.defaultView!;
	const owners=new Map<HTMLElement,()=>void>();
	const dirty=new Set<HTMLElement>();
	let options: CodeBlockOptions | null=null;
	let frame: number | null=null;
	let destroyed=false;
	const observer=new ownerWindow.MutationObserver(records=>{
		for(const record of records) {
			const element=record.target.nodeType===1 ? record.target as HTMLElement : record.target.parentElement;
			const pre=element?.closest<HTMLElement>('pre');
			if(pre && owners.has(pre) && (element===pre || element?.closest('code')))dirty.add(pre);
		}
		schedule();
	});
	function apply(): void {
		frame=null;
		if(destroyed)return;
		observer.disconnect();
		const next=config.getOptions();
		const changed=!options || options.codeLineNumbers!==next.codeLineNumbers || options.codeWordWrap!==next.codeWordWrap;
		const candidates=new Set(config.isActive() ? root.querySelectorAll<HTMLElement>(CONTAINER_CODE) : []);
		for(const [pre,cleanup] of owners) {
			if(!candidates.has(pre) || changed || dirty.has(pre)) {cleanup();owners.delete(pre);}
		}
		for(const pre of candidates)if(!owners.has(pre))owners.set(pre,createCodeBlockDisplay(pre,next));
		dirty.clear();options={...next};
		observer.observe(root,{childList:true,subtree:true,characterData:true});
	}
	function schedule(): void {
		if(!destroyed && frame===null)frame=ownerWindow.requestAnimationFrame(apply);
	}
	observer.observe(root,{childList:true,subtree:true,characterData:true});schedule();
	return {
		refresh:schedule,
		destroy() {
			destroyed=true;observer.disconnect();
			if(frame!==null)ownerWindow.cancelAnimationFrame(frame);
			frame=null;
			for(const cleanup of owners.values())cleanup();
			owners.clear();dirty.clear();
		},
	};
}
