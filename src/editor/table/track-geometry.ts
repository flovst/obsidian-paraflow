import type {TableAxis,TableModel} from './model';

export interface TrackGeometry {
	readonly axis:TableAxis;
	readonly edges:readonly number[];
	readonly blocks:readonly {first:number;last:number}[];
}

/** Shared span closure makes the displayed destination a legal reorder boundary. */
export function readTrackGeometry(table:HTMLTableElement,model:TableModel,axis:TableAxis):TrackGeometry {
	const count=axis==='row'?model.rows:model.columns,edges=Array<number>(count+1).fill(Number.NaN);
	const span=axis==='row'?'rowSpan':'columnSpan';
	const rtl=axis==='column'&&table.ownerDocument.defaultView!.getComputedStyle(table).direction==='rtl';
	const start=(box:DOMRect)=>axis==='row'?box.top:rtl?box.right:box.left;
	const end=(box:DOMRect)=>axis==='row'?box.bottom:rtl?box.left:box.right;
	const box=table.getBoundingClientRect();edges[0]=start(box);edges[count]=end(box);
	const cells=Array.from(table.querySelectorAll<HTMLElement>('td,th'));
	model.cells.forEach((cell,index)=>{const rect=cells[index]!.getBoundingClientRect();if(!rect.width||!rect.height)return;edges[cell[axis]]=start(rect);edges[cell[axis]+cell[span]]=end(rect);});
	if(axis==='row')Array.from(table.rows).forEach((row,index)=>{const rect=row.getBoundingClientRect();if(rect.height){edges[index]=rect.top;edges[index+1]=rect.bottom;}});
	const joined=Array<boolean>(count).fill(false);
	for(const cell of model.cells)for(let track=cell[axis]+1;track<cell[axis]+cell[span];track++)joined[track]=true;
	const blocks:{first:number;last:number}[]=[];
	for(let first=0;first<count;){let last=first;while(last+1<count&&joined[last+1])last++;blocks.push({first,last});first=last+1;}
	return {axis,edges,blocks};
}

export function trackDropTarget(geometry:TrackGeometry,first:number,last:number,coordinate:number):{destination:number;boundary:number}|null {
	const {edges,blocks}=geometry,sign=edges[edges.length-1]!>=edges[0]!?1:-1;
	if(coordinate*sign<edges[0]!*sign||coordinate*sign>edges[edges.length-1]!*sign)return null;
	const hit=blocks.find(block=>coordinate*sign>=edges[block.first]!*sign&&coordinate*sign<=edges[block.last+1]!*sign)!;
	if(hit.last<first)return {destination:hit.first,boundary:edges[hit.first]!};
	if(hit.first>last)return {destination:hit.last-(last-first),boundary:edges[hit.last+1]!};
	return {destination:first,boundary:edges[first]!};
}
