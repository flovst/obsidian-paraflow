interface Token {from:number;to:number;raw:string;tag:string;closing:boolean;}
const containers=new Set(['table','thead','tbody','tfoot','tr','colgroup']);
const contents=new Set(['td','th','caption']);

/** Only structural whitespace is rewritten; cells and authored HTML tokens stay byte-exact. */
export function formatHtmlTable(source:string):string {
 const tokens:Token[]=[];
 const pattern=/<!--[\s\S]*?-->|<(script|style|textarea|title)\b(?:"[^"]*"|'[^']*'|[^'">])*?>[\s\S]*?<\/\1\s*>|<\/?[A-Za-z][\w:-]*(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>/giu;
 for(const match of source.matchAll(pattern)){
  const name=/^<(\/?)([A-Za-z][\w:-]*)/u.exec(match[0]);
  tokens.push({from:match.index,to:match.index+match[0].length,raw:match[0],tag:match[1]?'':name?.[2]?.toLowerCase()??'',closing:name?.[1]==='/'});
 }
 const lines:string[]=[],stack:string[]=[];let offset=0;
 const fail=():never=>{throw new Error('无法格式化 HTML 表格：请使用完整、明确闭合的表格结构。');};
 const line=(raw:string)=>lines.push('  '.repeat(stack.length)+raw);
 for(let index=0;index<tokens.length;index++){
  const token=tokens[index]!;
  if(source.slice(offset,token.from).trim())fail();
  if(token.raw.startsWith('<!--')){line(token.raw);offset=token.to;continue;}
  if(contents.has(token.tag)&&!token.closing){
   if(token.tag==='caption'?stack.at(-1)!=='table':stack.at(-1)!=='tr')fail();
   let depth=1,end=index;
   while(++end<tokens.length){const candidate=tokens[end]!;if(candidate.tag===token.tag)depth+=candidate.closing?-1:1;if(!depth)break;}
   if(depth)fail();line(source.slice(token.from,tokens[end]!.to));offset=tokens[end]!.to;index=end;continue;
  }
  if(token.closing){if(stack.pop()!==token.tag)fail();line(token.raw);}
  else {
   const parent=stack.at(-1);
   if(token.tag==='table'?parent!==undefined||lines.length>0:token.tag==='tr'?parent!=='table'&&!['thead','tbody','tfoot'].includes(parent!):token.tag==='col'?parent!=='colgroup'&&parent!=='table':parent!=='table')fail();
   if(!containers.has(token.tag)&&token.tag!=='col')fail();
   line(token.raw);if(token.tag!=='col')stack.push(token.tag);
  }
  offset=token.to;
 }
 if(stack.length||source.slice(offset).trim()||tokens[0]?.tag!=='table'||tokens.at(-1)?.tag!=='table'||!tokens.at(-1)?.closing)fail();
 return lines.join(source.includes('\r\n')?'\r\n':'\n');
}
