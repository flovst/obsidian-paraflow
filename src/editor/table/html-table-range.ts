const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

/** Index source extents once; only grammar-confirmed opening positions may claim them. */
export function htmlBlockExtents(source:string):ReadonlyMap<number,{to:number;nested:boolean}> {
	const extents=new Map<number,{to:number;nested:boolean}>();
	const openings=new Map<string,Array<{from:number;nested:boolean}>>();
	for(const token of source.matchAll(/<\/?[A-Za-z][\w-]*(?=\s|>)(?:"[^"]*"|'[^']*'|[^<'">])*>/gu)){
		const name=/^<(\/?)([A-Za-z][\w-]*)(?=\s|>)/u.exec(token[0]);if(!name)continue;
		const tag=name[2]!.toLowerCase();if(voidTags.has(tag))continue;
		let stack=openings.get(tag);
		if(!name[1]){
			if(!stack){stack=[];openings.set(tag,stack);}
			if(stack.length)stack[stack.length-1]!.nested=true;
			stack.push({from:token.index,nested:false});
		}else if(/^<\/[A-Za-z][\w-]*\s*>$/u.test(token[0])){
			const opening=stack?.pop();if(opening)extents.set(opening.from,{to:token.index+token[0].length,nested:opening.nested});
		}
	}
	return extents;
}
