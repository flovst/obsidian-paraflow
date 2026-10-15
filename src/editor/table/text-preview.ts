import {admittedFragment} from './admitted-dom';

/** A visual candidate never mutates an editable node or its live DOM Range. */
export function showTextPreview(element:HTMLElement,html:string):()=>void {
	const overlay=element.ownerDocument.createElement('div');overlay.className='paraflow-table-text-preview';
	const computed=element.ownerDocument.defaultView!.getComputedStyle(element);const box=element.getBoundingClientRect();
	for(const property of ['font-family','font-size','font-weight','font-style','line-height','color','text-align','padding','border','white-space','overflow-wrap'])overlay.style.setProperty(property,computed.getPropertyValue(property));
	overlay.style.backgroundColor=computed.backgroundColor==='rgba(0, 0, 0, 0)'?'var(--background-primary)':computed.backgroundColor;
	overlay.style.left=`${box.left}px`;overlay.style.top=`${box.top}px`;overlay.style.width=`${box.width}px`;overlay.style.minHeight=`${box.height}px`;
	overlay.append(admittedFragment(element.ownerDocument,html));element.ownerDocument.body.append(overlay);
	return ()=>overlay.remove();
}
