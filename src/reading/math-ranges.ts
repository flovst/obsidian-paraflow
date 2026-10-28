import { createDetachedEl } from '../dom';
import {parser, GFM} from '@lezer/markdown';
import {scanMathRanges} from '../editor/math/range-scanner.js';
import {mathSourceMarkers} from '../editor/math/transient-source.js';
import {metadataGrammar,nativeInlineGrammarFor} from '../editor/markdown-grammar.js';
import {buildFootnoteIndex,footnoteDefinitionContent,type FootnoteReference,type FootnoteIndex} from '../editor/footnotes/index.js';
import {adaptReadingBodyTabSource} from './body-tab-source.js';

const referenceGrammar=parser.configure([GFM,metadataGrammar]);
interface Section {readonly text:string;readonly lineStart:number;readonly lineEnd:number}
type Own=(cleanup:()=>void,onload?:()=>void)=>void;
type Render=(source:string,target:HTMLElement,path:string,own:Own)=>Promise<void>;
type RenderMath=(source:string,display:boolean,owner:Document)=>HTMLElement|Promise<HTMLElement>;
interface InlineMath {readonly start:string;readonly end:string;readonly source:string;readonly tex:string;readonly replacement:string}
interface ReadingFootnoteReference extends FootnoteReference {readonly inline:boolean}
export interface ReadingSourceOptions {readonly math:boolean;readonly bodyTabs:boolean}

/** Definitions are invisible context; original document order keeps first-definition precedence. */
function referenceContext(source:string):string {
 const definitions:string[]=[];
 referenceGrammar.configure(nativeInlineGrammarFor(scanMathRanges(source).expressions)).parse(source).iterate({enter(node){
  if(node.name!=='LinkReference')return undefined;
  const label=node.node.getChild('LinkLabel')!;
  if(!source.slice(label.from,label.to).startsWith('[^')){
   let definition=source.slice(node.from,node.to);
   const prefixes=new Map<number,number>();
   for(const mark of node.node.getChildren('QuoteMark'))prefixes.set(source.lastIndexOf('\n',mark.from-1)+1,mark.to);
   for(const [from,to] of [...prefixes].reverse()){
    definition=definition.slice(0,from-node.from)+definition.slice(to-node.from).replace(/^[ \t]*/u,'  ');
   }
   definitions.push(definition);
  }
  return false;
 }});
 return definitions.length?definitions.join('\n')+'\n\n':'';
}

function projectReadingMathSource(source:string):{source:string;inline:readonly InlineMath[]}|null {
 const index=scanMathRanges(source),protectedRanges=[...index.expressions,...index.opaque];
 const edits:{from:number;to:number;insert:string}[]=[],inline:InlineMath[]=[],allocate=mathSourceMarkers(source);
 for(const math of index.expressions.filter(math=>!math.display&&math.contentFrom-math.from===2)){
  const start=allocate(),end=allocate(),continuation=allocate();
  const depth=(source.slice(source.lastIndexOf('\n',math.from-1)+1,math.from).match(/>/gu)??[]).length;
  const prefix=(line:string):string=>{
   let result='';
   for(let count=0;count<depth;count++){const part=/^[ \t]*>[ \t]?/u.exec(line.slice(result.length))?.[0];if(!part)break;result+=part;}
   return result;
  };
  const original=source.slice(math.from,math.to),rows=original.split('\n');
  const replacement=rows.map((row,at)=>(at?prefix(row):'')+(at===0?start:continuation)+(at===rows.length-1?end:'')+(row.endsWith('\r')?'\r':'')).join('\n');
  const tex=source.slice(math.contentFrom,math.contentTo).split('\n').map((row,at)=>at?row.slice(prefix(row).length):row).join('\n');
  inline.push({start,end,source:original,tex,replacement});edits.push({from:math.from,to:math.to,insert:replacement});
 }
 for(const match of source.matchAll(/\$/gu)){
  const at=match.index;
  if(protectedRanges.some(range=>range.from<=at&&at<range.to))continue;
  let slashes=0;for(let before=at-1;before>=0&&source[before]==='\\';before--)slashes++;
  if(slashes%2===0)edits.push({from:at,to:at+1,insert:'\\$'});
 }
 if(!edits.length)return null;
 let result=source;
 for(const edit of edits.sort((a,b)=>b.from-a.from))result=result.slice(0,edit.from)+edit.insert+result.slice(edit.to);
 return {source:result,inline};
}
/** The transient input preserves physical rows; double-dollar inline math has explicit ownership. */
export function adaptReadingMathSource(source:string):string|null {return projectReadingMathSource(source)?.source??null;}

/** Shared source adaptation preserves native rich Markdown and section/component ownership. */
export function createReadingMathRanges(renderMarkdown:Render,renderMath?:RenderMath) {
 const nested=new WeakSet<HTMLElement>(),owners=new Map<HTMLElement,()=>void>();
 const documents=new Map<string,{
  text:string;owner:Document;refs:readonly FootnoteReference[];footer:HTMLElement;ready:Promise<void>;
  roots:Set<HTMLElement>;dispose:(()=>void)[];current:boolean;
 }>();
 const finishers=new WeakMap<HTMLElement,()=>void>();
 let analysis:{source:string;math:boolean;bodyTabs:boolean;adapted:string|null;inline:readonly InlineMath[];index:FootnoteIndex|null;references:string}|null=null;
 let alive=true;
 const inside=(root:HTMLElement):boolean=>{for(let el:HTMLElement|null=root;el;el=el.parentElement)if(nested.has(el))return true;return false;};
 const mountInline=async(target:HTMLElement,inlineMath:readonly InlineMath[],valid:()=>boolean):Promise<void>=>{
    for(const math of inlineMath){
     if(!valid())return;
     // Destination attributes retain literal source; they are not visible math owners.
     for(const element of target.querySelectorAll('*'))for(const attribute of [...element.attributes]){
      const value=attribute.value.replaceAll(math.replacement,()=>math.source).replaceAll(encodeURIComponent(math.replacement),()=>encodeURIComponent(math.source));
      if(value!==attribute.value)element.setAttribute(attribute.name,value);
     }
     const walker=target.ownerDocument.createTreeWalker(target,4);
     let first:Text|null=null,last:Text|null=null;
     for(let node=walker.nextNode();node;node=walker.nextNode()){
      const text=node as Text;
      if(text.data.includes(math.start))first=text;
      if(text.data.includes(math.end))last=text;
     }
     if(!first&&!last)continue;
     if(!first||!last)throw new Error('Reading section split an inline math expression');
     if(!renderMath)throw new Error('Reading inline math renderer is unavailable');
     const result=await renderMath(math.tex,false,target.ownerDocument);
     if(!valid())return;
     const host=createDetachedEl(target.ownerDocument, 'span');host.className='math math-inline is-loaded paraflow-math-rendered';host.append(result);
     const range=target.ownerDocument.createRange();range.setStart(first,first.data.indexOf(math.start));range.setEnd(last,last.data.indexOf(math.end)+math.end.length);
     range.deleteContents();range.insertNode(host);
    }
 };
 const destination=(docId:string,number:number)=>`fn-${number}-paraflow-${encodeURIComponent(docId)}`;
 const referenceId=(docId:string,ref:FootnoteReference)=>`fnref-${ref.number}-${ref.occurrence}-paraflow-${encodeURIComponent(docId)}`;
 return {
  async render(root:HTMLElement,section:Section|null,path:string,own:Own,docId='',options:ReadingSourceOptions={math:true,bodyTabs:false}):Promise<boolean>{
   if(!alive||!section||inside(root))return false;
   const lines=(text:string)=>text.split('\n').slice(section.lineStart,section.lineEnd+1).join('\n');
   if(analysis?.source!==section.text||analysis.math!==options.math||analysis.bodyTabs!==options.bodyTabs){
    const body=options.bodyTabs?adaptReadingBodyTabSource(section.text):null;
    const projection=options.math?projectReadingMathSource(body??section.text):null,adapted=projection?.source??body;
    analysis={source:section.text,...options,adapted,inline:projection?.inline??[],index:adapted===null?null:buildFootnoteIndex(adapted),references:adapted===null?'':referenceContext(adapted)};
   }
   const adapted=analysis.adapted;
   if(adapted===null)return false;
   const inlineMath=analysis.inline;
   const referenceDefinitions=analysis.references;
   let sectionSource=lines(adapted);
   const index=docId?analysis.index:null;
   const inlineRefs:ReadingFootnoteReference[]=(index?.inlineNotes??[]).map(note=>{
    let id=`paraflow-inline-${note.from}`;
    while(index!.definitions.some(def=>def.id===id))id+='-';
    return {...note,id,occurrence:1,status:'resolved',inline:true};
   });
   const refs:ReadingFootnoteReference[]=[...(index?.references.filter(ref=>ref.status!=='missing').map(ref=>({...ref,inline:false}))??[]),...inlineRefs].sort((a,b)=>a.from-b.from);
   const start=adapted.split('\n').slice(0,section.lineStart).reduce((offset,line)=>offset+line.length+1,0);
   const sectionRefs=refs.filter(ref=>start<=ref.from&&ref.to<=start+sectionSource.length);
   const nativeFooter=root.matches('.footnotes')||root.querySelector('.footnotes')!==null;
   const finalSection=refs.length>0&&section.lineEnd>=adapted.trimEnd().split('\n').length-1;
   if(sectionSource===lines(section.text)&&!sectionRefs.length&&!nativeFooter&&!finalSection)return false;
   owners.get(root)?.();
   const referenceHTML=(ref:ReadingFootnoteReference)=>{
    const sup=createDetachedEl(root.ownerDocument, 'sup');sup.className='footnote-ref';sup.dataset.paraflowFootref=String(ref.from);
    sup.id=referenceId(docId,ref);
    const anchor=createDetachedEl(root.ownerDocument, 'a');anchor.className='footnote-link';
    if(!ref.inline)anchor.dataset.footref=ref.id;
    anchor.href='#'+destination(docId,ref.number);anchor.textContent=`[${ref.number}${ref.occurrence>1?'-'+(ref.occurrence-1):''}]`;sup.append(anchor);
    return sup.outerHTML;
   };
   const rewrite=(from:number,to:number)=>{
    let text=adapted.slice(from,to);
    for(const ref of refs.filter(ref=>from<=ref.from&&ref.to<=to).reverse())text=text.slice(0,ref.from-from)+referenceHTML(ref)+text.slice(ref.to-from);
    return text;
   };
   let group=documents.get(docId);
   if(refs.length&&(!group||group.text!==adapted||group.owner!==root.ownerDocument)){
    if(group){group.current=false;group.footer.remove();for(const dispose of group.dispose.splice(0).reverse())dispose();}
    const footer=createDetachedEl(root.ownerDocument, 'div');footer.className='paraflow-reading-math-section markdown-rendered';nested.add(footer);
    const created={text:adapted,owner:root.ownerDocument,refs,footer,ready:Promise.resolve(),roots:new Set<HTMLElement>(),dispose:[] as (()=>void)[],current:true};
    group=created;documents.set(docId,created);
    const definitions=[...index!.definitions.filter((def,at,all)=>def.references.length&&!all.slice(at+1).some(item=>item.id===def.id)).map(def=>{
     const from=adapted.lastIndexOf('\n',def.from-1)+1;
     return {id:def.id,number:def.number!,references:def.references,inline:false,content:footnoteDefinitionContent(rewrite(from,adapted.length),{...def,from:def.from-from,to:def.to-from})};
    }),...inlineRefs.map(ref=>({id:ref.id,number:ref.number,references:[ref],inline:true,content:adapted.slice(ref.from+2,ref.to-1)}))].sort((a,b)=>a.number-b.number);
    const context=definitions.map(def=>`[^${def.id}]`).join(' ')+'\n\n'+definitions.map(def=>
     `[^${def.id}]: ${def.content.replaceAll('\n','\n    ')}`).join('\n\n');
    created.ready=renderMarkdown(referenceDefinitions+context,footer,path,dispose=>{if(created.current)created.dispose.push(dispose);else dispose();}).then(async()=>{
     if(!created.current)return;
     const appendix=footer.querySelector<HTMLElement>('section.footnotes');
     if(!appendix)throw new Error('Reading footnote context did not render an appendix');
     footer.replaceChildren(appendix);
     const items=[...appendix.querySelectorAll<HTMLElement>(':scope > ol > li')];
     for(const [at,def] of definitions.entries()){
      const item=items[at];if(!item)throw new Error('Reading footnote context lost a definition');
      item.id=destination(docId,def.number);item.removeAttribute('data-footnote-id');
      item.dataset.paraflowFootnoteId=def.inline?'':def.id;
      item.setAttribute('value',String(def.number));
      for(const back of item.querySelectorAll('.footnote-backref'))back.remove();
      for(const ref of def.references){
       const back=createDetachedEl(root.ownerDocument, 'a');back.className='footnote-backref footnote-link';
       back.href='#'+referenceId(docId,ref);back.textContent='↩︎';(item.querySelector('p')??item).append(back);
      }
     }
     await mountInline(footer,inlineMath,()=>created.current);
    });
   }
   if(group?.text!==adapted||group?.owner!==root.ownerDocument)group=undefined;
   sectionSource=rewrite(start,start+sectionSource.length);
   const source=referenceDefinitions+sectionSource;
   const original=[...root.childNodes],target=createDetachedEl(root.ownerDocument, 'div'),children:(()=>void)[]=[];
   target.className='paraflow-reading-math-section markdown-rendered';nested.add(target);
   let current=true;
   const documentGroup=group;
   documentGroup?.roots.add(root);
   const mount=()=>{
    if(!current||!documentGroup?.current||(!finalSection&&!nativeFooter))return;
    // The host reconciles preview-sizer children; an owned section must contain the appendix.
    if(documentGroup.footer.parentElement!==root)root.append(documentGroup.footer);
   };
   const finish=()=>{
    if(!current||!documentGroup)return;
    for(const sup of target.querySelectorAll<HTMLElement>('sup[data-paraflow-footref]')){
     const ref=sectionRefs.find(item=>String(item.from)===sup.dataset.paraflowFootref)!;
     sup.id=referenceId(docId,ref);sup.removeAttribute('data-footnote-id');
     sup.querySelector('a')!.setAttribute('href','#'+destination(docId,ref.number));
    }
    mount();
   };
   finishers.set(root,finish);
   const cleanup=()=>{
    if(!current)return;current=false;
    finishers.delete(root);
    for(const dispose of children.reverse())dispose();
    if(documentGroup?.footer.parentElement===root)documentGroup.footer.remove();
    if(root.childNodes.length===1&&root.firstChild===target)root.replaceChildren(...original);
    if(owners.get(root)===cleanup)owners.delete(root);
    if(documentGroup){
     documentGroup.roots.delete(root);
     if(!documentGroup.roots.size){
      documentGroup.current=false;
      documentGroup.footer.remove();for(const dispose of documentGroup.dispose.splice(0).reverse())dispose();
      if(documents.get(docId)===documentGroup)documents.delete(docId);
     }
    }
   };
   owners.set(root,cleanup);own(cleanup,mount);root.replaceChildren(target);
   try{
    if(documentGroup)await documentGroup.ready;
    await renderMarkdown(source,target,path,dispose=>{if(current)children.push(dispose);else dispose();});
    await mountInline(target,inlineMath,()=>current);
    finish();
   }
   catch(error){cleanup();throw error;}
   return true;
  },
  finish(root:HTMLElement){finishers.get(root)?.();},
  destroy(){alive=false;for(const cleanup of [...owners.values()])cleanup();},
 };
}
