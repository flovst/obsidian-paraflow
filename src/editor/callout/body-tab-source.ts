import {GFM,parser} from '@lezer/markdown';
import {quotePrefix} from './prefix.js';
import {metadataGrammar,nativeInlineGrammarFor} from '../markdown-grammar.js';
import {scanMathRanges} from '../math/range-scanner.js';
import {htmlBlockExtents} from '../table/html-table-range.js';

/** Preserve source-column paragraph ownership when the host strips quote prefixes. */
export function quotedParagraphTabStarts(source:string):readonly number[] {
 return quotedTabStarts(source).paragraphs;
}

/** Opening indentation and following body keep their full-source owner after prefix removal. */
export function quotedTabStarts(source:string):{paragraphs:readonly number[];blocks:readonly number[]} {
 const inserts=new Set<number>();
 const blocks=new Set<number>();
 const math=scanMathRanges(source);
 const tree=parser.configure([GFM,metadataGrammar,nativeInlineGrammarFor(math.expressions)]).parse(source);
 const opaque=[...math.expressions,...math.opaque];
 tree.iterate({enter(node){if(/^(?:InlineCode|HTMLTag|CalloutNativeInline|Comment|URL|LinkTitle)$/u.test(node.name))opaque.push({from:node.from,to:node.to});}});
 tree.iterate({enter(node){
  if(node.name!=='Paragraph'&&node.name!=='HTMLBlock')return undefined;
  let depth=0;
  for(let parent=node.node.parent;parent;parent=parent.parent){
   if(!depth&&parent.name==='ListItem')return undefined;
   if(parent.name==='Blockquote')depth++;
  }
  if(!depth)return undefined;
  if(node.name==='HTMLBlock'){
   const from=source.lastIndexOf('\n',node.from-1)+1;
   const line=source.slice(from,source.indexOf('\n',from)<0?source.length:source.indexOf('\n',from));
   const prefix=quotePrefix(line,depth)!;
   const whitespace=/^[ \t]*/u.exec(line.slice(prefix.length))![0];
   if(whitespace.includes('\t'))blocks.add(from+prefix.length+whitespace.indexOf('\t'));
   const extent=htmlBlockExtents(source).get(node.from);
   if(extent&&extent.to<node.to){
    const next=source.indexOf('\n',extent.to);
    if(next>=0&&next<node.to){const tail=quotedTabStarts(source.slice(next+1,node.to));for(const at of tail.paragraphs)inserts.add(next+1+at);for(const at of tail.blocks)blocks.add(next+1+at);}
   }
   return false;
  }
  let from=source.lastIndexOf('\n',node.from-1)+1;
  while(from<=node.to){
   const newline=source.indexOf('\n',from),to=newline<0?source.length:newline;
   const line=source.slice(from,to),prefix=quotePrefix(line,depth);
   if(prefix!==null){
    const whitespace=/^[ \t]*/u.exec(line.slice(prefix.length))![0];
    const at=from+prefix.length+whitespace.indexOf('\t');
    if(whitespace.includes('\t')&&!opaque.some(range=>range.from<=at&&at<range.to))inserts.add(at);
   }
   if(newline<0||newline>=node.to)break;
   from=newline+1;
  }
  return undefined;
 }});
 return {paragraphs:[...inserts].sort((a,b)=>a-b),blocks:[...blocks].sort((a,b)=>a-b)};
}
