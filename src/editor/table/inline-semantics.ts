import { createDetachedEl, createOwnedFragment } from '../../dom';
import {parseStyle, TableSerializationError} from './html-serialization';
import {ident} from 'css-tree';
import {isHighlightColor,type HighlightColor} from './highlight';
import {createWikiAnchor,isWikiAnchor,isWikiAttribute,readWikiAnchor} from './wiki-links';

interface InlineState {bold:boolean;italic:boolean;boldOff:boolean;italicOff:boolean;strike:boolean;underline:boolean;highlight:HighlightColor|null;link?:Element;}
export interface InheritedInlineFormats {readonly bold:boolean;readonly italic:boolean;}
type Loss=(kind:'inline-attribute'|'inline-element',message:string)=>void;
const aliases:Record<string,string>={b:'strong',i:'em',del:'s',strike:'s'};

/** Finite semantic decoding, shared by Markdown output and its round-trip authority. */
export function normalizeInlineNodes(nodes:readonly Node[],row:number,column:number,onLoss?:Loss,inheritedFormats:InheritedInlineFormats={bold:false,italic:false}):Node[] {
 const doc=nodes[0]?.ownerDocument??document,output=createOwnedFragment(doc);let emitted=0;
 const linkOrigins=new WeakMap<Element,Element>();
 const lose=(kind:'inline-attribute'|'inline-element',message:string)=>{
  if(onLoss)onLoss(kind,message);else throw new TableSerializationError(message,row+1,column+1);
 };
 const same=(left:Element,right:Element)=>left.localName===right.localName&&left.attributes.length===right.attributes.length&&Array.from(left.attributes).every(attr=>right.getAttribute(attr.name)===attr.value);
 const append=(node:Node,state:InlineState)=>{
  emitted++;
  if(inheritedFormats.bold&&state.boldOff)lose('inline-attribute','Local normal font-weight overrides inherited cell bold and cannot be expressed in Markdown');
  if(inheritedFormats.italic&&state.italicOff)lose('inline-attribute','Local normal font-style overrides inherited cell italic and cannot be expressed in Markdown');
  const wrappers:Element[]=[];
  if(state.link)wrappers.push(state.link.cloneNode(false) as Element);
  for(const [enabled,tag] of [[state.bold,'strong'],[state.italic,'em'],[state.strike,'s'],[state.underline,'u']] as const)if(enabled)wrappers.push(createDetachedEl(doc, tag));
  if(state.highlight!==null){const mark=createDetachedEl(doc, 'mark');if(state.highlight)mark.setAttribute('data-highlight',state.highlight);wrappers.push(mark);}
  let parent:Node=output;
  for(const wrapper of wrappers){const last=parent.lastChild;if(last?.nodeType===1&&same(last as Element,wrapper)&&(wrapper.localName!=='a'||linkOrigins.get(last as Element)===state.link))parent=last;else{if(wrapper.localName==='a'&&state.link)linkOrigins.set(wrapper,state.link);parent.appendChild(wrapper);parent=wrapper;}}
  if(node.nodeType===3&&parent.lastChild?.nodeType===3)parent.lastChild.textContent=(parent.lastChild.textContent??'')+(node.textContent??'');else parent.appendChild(node);
 };
 const visit=(node:Node,inherited:InlineState):void=>{
  if(node.nodeType===3){append(node.cloneNode(true),inherited);return;}
  if(node.nodeType!==1)throw new TableSerializationError('Unsupported inline node',row+1,column+1);
  const element=node as Element,tag=aliases[element.localName]??element.localName,state={...inherited},wiki=isWikiAnchor(element);
  let wikiLink:ReturnType<typeof readWikiAnchor>|null=null;
  if(wiki){try{wikiLink=readWikiAnchor(element);}catch(error){lose('inline-attribute',error instanceof Error?error.message:String(error));}}
  if(tag==='strong'){state.bold=true;state.boldOff=false;}
  if(tag==='em'){state.italic=true;state.italicOff=false;}
  let ownStrike=tag==='s',ownUnderline=tag==='u',decorationImportant=false;
  if(tag==='mark')state.highlight='';
  for(const attribute of Array.from(element.attributes)){
   if(wiki&&isWikiAttribute(attribute))continue;
   if(!wiki&&tag==='a'&&['href','title'].includes(attribute.name))continue;
   if(tag==='mark'&&attribute.name==='data-highlight'&&isHighlightColor(attribute.value)){state.highlight=attribute.value;continue;}
   if(attribute.name!=='style'){lose('inline-attribute',`Inline attribute ${attribute.name} on <${element.localName}> cannot be expressed in Markdown`);continue;}
   const style=parseStyle(attribute.value,row,column);
   for(const [property,raw] of Object.entries(style)){
    const value=ident.decode(raw.replace(/\s*!important\s*$/iu,'').trim()).toLowerCase();
    const numericWeight=/^[+]?\d+(?:\.\d+)?$/u.test(value)?Number(value):NaN;
    if(property==='font-weight'&&(['bold','normal'].includes(value)||numericWeight===700||numericWeight===400)){state.bold=value==='bold'||numericWeight===700;state.boldOff=!state.bold;continue;}
    if(property==='font-style'&&['italic','normal'].includes(value)){state.italic=value==='italic';state.italicOff=!state.italic;continue;}
    if(['text-decoration','text-decoration-line'].includes(property)){
     const tokens=value.split(/\s+/u);
     if(value==='none'||tokens.length&&tokens.every(token=>['underline','line-through'].includes(token))){
      const important=/\s*!important\s*$/iu.test(raw);
      if(!decorationImportant||important){ownStrike=tokens.includes('line-through');ownUnderline=tokens.includes('underline');decorationImportant=important;}continue;
     }
    }
    lose('inline-attribute',`Inline style ${property}: ${raw} cannot be expressed in Markdown`);
   }
  }
  // Resolve declarations on this element first, then include ancestor decoration painting.
  state.strike ||= ownStrike;state.underline ||= ownUnderline;
  if(tag==='a'){
   if(wiki&&wikiLink)state.link=createWikiAnchor(doc,wikiLink);
   else{const link=createDetachedEl(doc, 'a');for(const name of ['href','title'])if(element.hasAttribute(name))link.setAttribute(name,element.getAttribute(name)!);state.link=link;}
  }
  if(tag==='code'||tag==='br'){
   const leaf=createDetachedEl(doc, tag);if(tag==='code')leaf.textContent=element.textContent;append(leaf,state);return;
  }
  if(!['span','strong','em','s','u','mark','a'].includes(tag))lose('inline-element',`Inline ${tag} cannot be expressed in Markdown`);
  let previous=node.previousSibling;while(previous?.nodeType===3&&!previous.textContent?.trim())previous=previous.previousSibling;
  if(tag==='p'&&previous&&!(previous.nodeType===1&&['p','br'].includes((previous as Element).localName)))append(createDetachedEl(doc, 'br'),inherited);
  const before=emitted;for(const child of Array.from(element.childNodes))visit(child,state);
  if(tag==='a'&&emitted===before)append(doc.createTextNode(''),state);
  if(tag==='p'&&node.nextSibling)append(createDetachedEl(doc, 'br'),inherited);
 };
 for(const node of nodes)visit(node,{bold:false,italic:false,boldOff:false,italicOff:false,strike:false,underline:false,highlight:null});
 return Array.from(output.childNodes);
}
