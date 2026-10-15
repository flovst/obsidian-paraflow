import type {TableEditSession} from './edit-session';
import type {CellPosition} from './model';

interface SourceNode {from:number;to:number;contentFrom:number;contentTo:number;children:SourceNode[];text?:number[];}
interface SourceCell extends SourceNode {position:CellPosition;}
interface DOMPoint {node:Node;offset:number;}

/** Maps admitted HTML directly; serialization must never be used to locate original text. */
export class HtmlTableSourceSelection {
 private readonly cells:SourceCell[]=[];
 private readonly lines:Array<{semantic:number;raw:number;length:number}>;
 constructor(session:TableEditSession,doc:Document){
  let semantic=0,raw=session.target.from;
  this.lines=session.target.source.split('\n').map((line,index)=>{const prefix=session.target.container?.prefixes[index]?.length??0;const result={semantic,raw:raw+prefix,length:line.length};semantic+=line.length+1;raw+=prefix+line.length+1;return result;});
  const parser=new doc.defaultView!.DOMParser();
  const textOffsets=(text:string,from:number):number[]=>{
   const offsets=[from];
   for(let index=0;index<text.length;){
    const entity=/^&(?:#[xX][\da-fA-F]+;?|#\d+;?|[A-Za-z][A-Za-z\d]*;?)/u.exec(text.slice(index))?.[0];
    if(entity){
     // Browser parsing handles named, numeric and semicolon-less references identically to the cell.
     const value=parser.parseFromString(entity,'text/html').body.textContent;
     if(value!==entity){let suffix=0;while(suffix<value.length&&value.at(-suffix-1)===entity.at(-suffix-1))suffix++;
      const consumed=entity.length-suffix,length=value.length-suffix;for(let char=1;char<=length;char++)offsets.push(from+index+(char===length?consumed:0));index+=consumed;continue;}
    }
    index+=text[index]==='\r'&&text[index+1]==='\n'?2:1;offsets.push(from+index);
   }
   return offsets;
  };
  const stack:SourceNode[]=[];let cellIndex=0;
  for(const token of session.target.source.matchAll(/<\/?[A-Za-z][\w-]*(?=[\s/>])(?:"[^"]*"|'[^']*'|[^<'">])*>|[^<]+/gu)){
   const value=token[0],from=token.index,to=from+value.length;
   if(value[0]!=='<'){if(stack.length)stack.at(-1)!.children.push({from,to,contentFrom:from,contentTo:to,children:[],text:textOffsets(value,from)});continue;}
   const tag=/^<(\/?)([A-Za-z][\w-]*)/u.exec(value)!;const name=tag[2]!.toLowerCase();
   if(tag[1]){if(stack.length){const node=stack.pop()!;node.contentTo=from;node.to=to;}continue;}
   if(name==='td'||name==='th'){
    const model=session.table.cells[cellIndex++]!;const cell={from,to,contentFrom:to,contentTo:to,children:[],position:{row:model.row,column:model.column}};this.cells.push(cell);stack.push(cell);
   }else if(stack.length){const node={from,to,contentFrom:to,contentTo:to,children:[]};stack.at(-1)!.children.push(node);if(name!=='br')stack.push(node);}
  }
 }
 private source(position:number):number {
  let index=this.lines.length-1;while(this.lines[index]!.semantic>position)index--;const line=this.lines[index]!;return line.raw+position-line.semantic;
 }
 private semantic(position:number):number {
  let index=this.lines.length-1;while(index>=0&&this.lines[index]!.raw>position)index--;const line=this.lines[index];return line?line.semantic+Math.min(line.length,position-line.raw):-1;
 }
 private cell(position:CellPosition):SourceCell {return this.cells.find(cell=>cell.position.row===position.row&&cell.position.column===position.column)!;}
 private fromPoint(root:HTMLElement,cell:SourceCell,node:Node,offset:number):number {
  const path:number[]=[];for(let current=node;current!==root;current=current.parentNode!)path.push(Array.prototype.indexOf.call(current.parentNode!.childNodes,current));
  const mapped=path.reverse().reduce((mapped,index)=>mapped.children[index]!,cell as SourceNode);
  return this.source(mapped.text?mapped.text[offset]!:offset<mapped.children.length?mapped.children[offset]!.from:mapped.contentTo);
 }
 selection(root:HTMLElement,position:CellPosition,selection:Selection):{anchor:number;head:number} {
  const cell=this.cell(position);return {anchor:this.fromPoint(root,cell,selection.anchorNode!,selection.anchorOffset),head:this.fromPoint(root,cell,selection.focusNode!,selection.focusOffset)};
 }
 private point(root:Node,mapped:SourceNode,position:number):DOMPoint {
  if(mapped.text){let offset=0;while(offset<mapped.text.length-1&&mapped.text[offset+1]!<=position)offset++;while(offset>0&&mapped.text[offset-1]===mapped.text[offset])offset--;return {node:root,offset};}
  for(const [index,child] of mapped.children.entries()){
   if(position<child.from)return {node:root,offset:index};
   if(position<=child.to){
    if(child.contentFrom===child.to&&child.contentTo===child.to)return {node:root,offset:index+(position===child.to?1:0)};
    if(position<child.contentFrom)return {node:root,offset:index};
    if(position>child.contentTo)return {node:root,offset:index+1};
    return this.point(root.childNodes[index]!,child,position);
   }
  }
  return {node:root,offset:mapped.children.length};
 }
 restore(anchor:number,head:number,cellElement:(position:CellPosition)=>HTMLElement|null):boolean {
  const a=this.semantic(anchor),h=this.semantic(head),cell=this.cells.find(cell=>cell.contentFrom<=a&&a<=cell.contentTo&&cell.contentFrom<=h&&h<=cell.contentTo);
  if(!cell)return false;const element=cellElement(cell.position);if(!element)return false;
  const start=this.point(element,cell,a),end=this.point(element,cell,h);element.focus();element.ownerDocument.getSelection()!.setBaseAndExtent(start.node,start.offset,end.node,end.offset);return true;
 }
}
