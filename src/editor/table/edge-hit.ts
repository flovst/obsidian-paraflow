/** The painted border belongs to the same coordinate strip on either DOM target. */
export function tableEdgeAxis(x:number,y:number,box:DOMRect,clip:DOMRect,edge:number):'row'|'column'|null {
 if(!box.width||!box.height)return null;
 if(x>=box.left-edge&&x<=box.left+edge&&y>=box.top&&y<=box.bottom&&box.left>=clip.left)return 'row';
 if(y>=box.top-edge&&y<=box.top+edge&&x>=Math.max(box.left,clip.left)&&x<=Math.min(box.right,clip.right))return 'column';
 return null;
}
