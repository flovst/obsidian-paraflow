/** Host decoration is derived from semantic links and never becomes authored HTML. */
export class TableLinkPresentation {
 private readonly authoredClasses=new WeakMap<Element,string|null>();
 decorate(root:ParentNode):void {
  for(const anchor of root.querySelectorAll('a[href]')){
   if(anchor.classList.contains('internal-link')||anchor.classList.contains('external-link'))continue;
   const destination=anchor.getAttribute('href')!;
   if(destination!==''&&!/^[\w+.-]+:/u.test(destination))continue;
   this.authoredClasses.set(anchor,anchor.getAttribute('class'));anchor.classList.add('external-link');
  }
 }
 hasDerived(root:ParentNode):boolean {
  return Array.from(root.querySelectorAll('a')).some(anchor=>this.authoredClasses.has(anchor));
 }
 cloneCell(cell:HTMLElement):HTMLElement {
  const clone=cell.cloneNode(true) as HTMLElement;
  const originals=[cell,...cell.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
  originals.forEach((element,index)=>{
   if(!this.authoredClasses.has(element))return;
   const authored=this.authoredClasses.get(element)!;
   if(authored===null)copies[index]!.removeAttribute('class');else copies[index]!.setAttribute('class',authored);
  });
  return clone;
 }
 cloneRange(cell:HTMLElement,range:Range):DocumentFragment {
  const clone=this.cloneCell(cell),endpoint=(node:Node):Node=>{
   const path:number[]=[];
   for(let current=node;current!==cell;current=current.parentNode!)path.push(Array.prototype.indexOf.call(current.parentNode!.childNodes,current));
   return path.reverse().reduce<Node>((current,index)=>current.childNodes[index]!,clone);
  };
  const canonical=cell.ownerDocument.createRange();canonical.setStart(endpoint(range.startContainer),range.startOffset);canonical.setEnd(endpoint(range.endContainer),range.endOffset);
  return canonical.cloneContents();
 }
}
