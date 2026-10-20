import {Parser,Tree,type Input,type TreeFragment} from '@lezer/common';

/** Parser indentation is not a hidden prefix: source-proven body Tabs remain editable. */
export function bodyTabParser(native:Parser,positions:readonly number[]):Parser {
 if(!positions.length)return native;
 return new class extends Parser {
  createParse(input:Input,fragments:readonly TreeFragment[],ranges:readonly {from:number;to:number}[]){
   const source=input.read(0,input.length);
   const partial=native.startParse(input,fragments,ranges);
   return {
    get parsedPos(){return partial.parsedPos;},get stoppedAt(){return partial.stoppedAt;},stopAt:(at:number)=>partial.stopAt(at),
    advance(){
     const tree=partial.advance();if(!tree)return null;
     const children:Tree[]=[],offsets:number[]=[];
     for(let node=tree.topNode.firstChild;node;node=node.nextSibling){
      const from=source.lastIndexOf('\n',node.from-1)+1;
      if(node.name==='Paragraph'&&positions.some(at=>from<=at&&at<node.from)&&/^[ \t]*$/u.test(source.slice(from,node.from))){
       const child=node.toTree(),shift=node.from-from;
       children.push(new Tree(child.type,child.children,child.positions.map(at=>at+shift),child.length+shift,child.propValues));offsets.push(from);
      }else{children.push(node.toTree());offsets.push(node.from);}
     }
     return new Tree(tree.type,children,offsets,tree.length,tree.propValues);
    },
   };
  }
 }();
}
