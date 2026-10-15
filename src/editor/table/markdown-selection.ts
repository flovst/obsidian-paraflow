import type {SyntaxNode} from '@lezer/common';
import {tableMarkdownParser} from './markdown-serialization';
import {decodeHighlightPrefix} from './highlight';
import {decodeWikiSource} from './wiki-links';

/** Exact character mapping, rather than searching for an ambiguous repeated label. */
function markdownTextOffsets(source:string,rendered:string):{from:number;to:number}[]|null {
	const characters:string[]=[];const offsets:{from:number;to:number}[]=[];
	const append=(value:string,from:number,to?:number)=>{for(let index=0;index<value.length;index++){characters.push(value[index]!);offsets.push({from:to===undefined?from+index:from,to:to??from+index+1});}};
	const visit=(node:SyntaxNode)=>{
		if(node.name==='PFWiki'){
			let link;try{link=decodeWikiSource(source.slice(node.from,node.to));}catch{return;}
			const from=node.from+2+(link.alias===null?0:link.target.length+2);append(link.alias??link.target,from);return;
		}
		if(node.name.endsWith('Mark')||(node.name==='URL'&&node.parent?.name==='Link')||node.name==='LinkTitle'||node.name==='HTMLTag')return;
		if(node.name==='Escape'){append(source.slice(node.from+1,node.to),node.from,node.to);return;}
		if(node.name==='Entity'){
			const parsed=new window.DOMParser().parseFromString(source.slice(node.from,node.to),'text/html');append(parsed.body.textContent??'',node.from,node.to);return;
		}
		if(node.name==='InlineCode'){
			let from=node.firstChild!.to,to=node.lastChild!.from;
			const text=source.slice(from,to).replace(/\\\|/gu,'|').replace(/\n/gu,' ');
			if(text.startsWith(' ')&&text.endsWith(' ')&&text.trim()){from++;to--;}
			for(let index=from;index<to;index++){
				if(source[index]==='\\'&&source[index+1]==='|'){append('|',index,index+2);index++;}
				else append(source[index]==='\n'?' ':source[index]!,index);
			}
			return;
		}
		let from=node.from,to=node.to;
		if(node.name==='PFHighlight'){from=node.firstChild!.to;to=node.lastChild!.from;from+=decodeHighlightPrefix(source.slice(from,to)).length;}
		if(node.name==='Link'){const marks=node.getChildren('LinkMark');from=marks[0]!.to;to=marks[1]!.from;}
		let cursor=from;
		for(let child=node.firstChild;child;child=child.nextSibling){
			if(child.from<from||child.to>to)continue;
			append(source.slice(cursor,child.from),cursor);visit(child);cursor=child.to;
		}
		append(source.slice(cursor,to),cursor);
	};
	visit(tableMarkdownParser.parse(source).topNode);
	if(characters.join('')!==rendered)return null;
	return offsets;
}

export function mapMarkdownTextSelection(source:string,from:number,to:number,rendered:string):{from:number;to:number}|null {
	const offsets=markdownTextOffsets(source,rendered);if(!offsets)return null;
	if(from===to){const index=offsets.findIndex(offset=>offset.from>=from);return {from:index<0?offsets.length:index,to:index<0?offsets.length:index};}
	const included=offsets.map((offset,index)=>offset.to>from&&offset.from<to?index:-1).filter(index=>index>=0);
	return included.length?{from:included[0]!,to:included[included.length-1]!+1}:null;
}

export function mapRenderedTextSelection(source:string,from:number,to:number,rendered:string):{from:number;to:number}|null {
	const offsets=markdownTextOffsets(source,rendered);if(!offsets||from>offsets.length||to>offsets.length)return null;
	const start=offsets[from]?.from??(offsets.length?offsets[offsets.length-1]!.to:0);return {from:start,to:from===to?start:offsets[to-1]!.to};
}
