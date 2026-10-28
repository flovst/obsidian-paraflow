import { createDetachedEl } from '../../dom';
import {bookmarkRange} from './action-target';
import {createWikiAnchor,isWikiAnchor,isWikiAttribute} from './wiki-links';

interface Piece {selected:boolean;node:Node;}

/** Split existing anchors at the saved selection, retaining labels and outside metadata. */
export function replaceTextLink(cell:HTMLElement,range:Range,href:string,title:string|null,wiki=false):number {
 const doc=cell.ownerDocument;
 const create=(label:string)=>{if(wiki)return createWikiAnchor(doc,{target:href,alias:label===href?null:label});const anchor=createDetachedEl(doc, 'a');anchor.setAttribute('href',href);if(title!==null)anchor.setAttribute('title',title);return anchor;};
 if(range.collapsed){
  const parent=range.startContainer.nodeType===1?range.startContainer as Element:range.startContainer.parentElement!,existing=parent.closest('a');
  if(existing){const internal=isWikiAnchor(existing),replacement=href?create(existing.textContent??''):createDetachedEl(doc, 'span');for(const attr of Array.from(existing.attributes))if(!['href','title'].includes(attr.name)&&!(internal&&isWikiAttribute(attr)))replacement.setAttribute(attr.name,attr.value);replacement.append(...Array.from(existing.childNodes));if(!href&&!replacement.attributes.length)existing.replaceWith(...Array.from(replacement.childNodes));else existing.replaceWith(replacement);return 0;}
  if(!href)return 0;
  const link=create(href);link.textContent=href;const code=parent.closest('code');
  if(code){
   const before=range.cloneRange(),after=range.cloneRange();before.selectNodeContents(code);before.setEnd(range.startContainer,range.startOffset);after.selectNodeContents(code);after.setStart(range.endContainer,range.endOffset);
   const fragment=doc.createDocumentFragment();for(const [part,node] of [[before,null],[null,link],[after,null]] as const){if(node)fragment.append(node);else if(part?.toString()){const segment=code.cloneNode(false);segment.textContent=part.toString();fragment.append(segment);}}code.replaceWith(fragment);
  }else range.insertNode(link);return href.length;
 }
 const {from,to}=bookmarkRange(cell,range),label=range.toString();let offset=0;
 const appendLinks=(pieces:readonly Piece[]):DocumentFragment=>{
  const fragment=doc.createDocumentFragment();let link:HTMLAnchorElement|null=null;
  for(const piece of pieces){if(piece.selected&&href){if(!link){link=create(label);fragment.append(link);}link.append(piece.node);}else{link=null;fragment.append(piece.node);}}
  return fragment;
 };
 const visit=(node:Node):Piece[]=>{
  if(node.nodeType===3){const text=node.textContent!,start=offset;offset+=text.length;const cuts=[...new Set([0,Math.max(0,Math.min(text.length,from-start)),Math.max(0,Math.min(text.length,to-start)),text.length])].sort((a,b)=>a-b);return cuts.slice(1).map((right,index)=>{const left=cuts[index]!;return {selected:start+left>=from&&start+right<=to,node:doc.createTextNode(text.slice(left,right))};});}
  const element=node as Element,children=Array.from(node.childNodes).flatMap(visit);if(!children.length)return [{selected:offset>=from&&offset<to,node:node.cloneNode(true)}];
  if(element.localName==='p'){const clone=element.cloneNode(false);clone.appendChild(appendLinks(children));return [{selected:false,node:clone}];}
  const pieces:Piece[]=[];
  for(let index=0;index<children.length;){const selected=children[index]!.selected;let clone=element.cloneNode(false) as Element;
   if(selected&&element.localName==='a'){clone=createDetachedEl(doc, 'span');const internal=isWikiAnchor(element);for(const attr of Array.from(element.attributes))if(!['href','title'].includes(attr.name)&&!(internal&&isWikiAttribute(attr)))clone.setAttribute(attr.name,attr.value);}
   while(index<children.length&&children[index]!.selected===selected)clone.append(children[index++]!.node);
   if(selected&&element.localName==='a'&&!clone.attributes.length)pieces.push(...Array.from(clone.childNodes).map(node=>({selected,node})));else pieces.push({selected,node:clone});
  }
  return pieces;
 };
 cell.replaceChildren(appendLinks(Array.from(cell.childNodes).flatMap(visit)));return to-from;
}
