import {EditorState} from '@codemirror/state';
import {bookmarkRange,rangeFromBookmark,type TextBookmark} from './action-target';
import {getTextToggleState} from './formatting';
import type {TableTextCommand} from './text-menu-model';

export type InlineToggleCommand='bold'|'italic'|'strikethrough'|'underline'|'code'|`highlight:${string}`;
type InlineFormatCommand=InlineToggleCommand|'clear';
export function isInlineFormattingCommand(command:TableTextCommand):command is InlineFormatCommand {
	return ['bold','italic','strikethrough','code','clear'].includes(command)||command.startsWith('highlight:');
}

function matches(element:HTMLElement,command:InlineFormatCommand):boolean {
	if(command==='clear')return ['STRONG','B','EM','I','DEL','S','STRIKE','U','MARK','CODE'].includes(element.tagName)||Array.from(element.style).some(property=>['font-weight','font-style','font-family','font-size','color','background-color'].includes(property)||property.startsWith('text-decoration'));
	if(command==='code')return element.tagName==='CODE';
	if(command.startsWith('highlight:'))return element.tagName==='MARK';
	if(command==='bold')return ['B','STRONG'].includes(element.tagName)||/^(bold|bolder)$/iu.test(element.style.fontWeight)||Number.parseInt(element.style.fontWeight,10)>=600;
	if(command==='italic')return ['I','EM'].includes(element.tagName)||/^(italic|oblique)(?:\s|$)/iu.test(element.style.fontStyle);
	if(command==='underline')return element.tagName==='U'||/(?:^|\s)underline(?:\s|$)/u.test(element.style.textDecorationLine||element.style.textDecoration);
	return ['DEL','S','STRIKE'].includes(element.tagName)||/(?:^|\s)line-through(?:\s|$)/u.test(element.style.textDecorationLine||element.style.textDecoration);
}

/** Primary toggles expand a caret locally; advanced cell-format targets are separate. */
export function textFormatTarget(cell:HTMLElement,bookmark:TextBookmark,command:InlineFormatCommand):TextBookmark|null {
	if(bookmark.from!==bookmark.to)return bookmark;
	// Logical bounds include both run edges regardless of DOM text-node affinity.
	// Reverse document order prefers the inner/right-hand run at shared edges.
	for(const element of Array.from(cell.querySelectorAll<HTMLElement>('*')).reverse()){
		if(matches(element,command)){
			const run=cell.ownerDocument.createRange();run.selectNodeContents(element);
			const offsets=bookmarkRange(cell,run);
			if(offsets.from===offsets.to||offsets.from>bookmark.from||bookmark.from>offsets.to)continue;
			if(command==='bold'||command==='italic'||command==='strikethrough'){
				const from=Math.min(bookmark.from,offsets.to-1),sample=rangeFromBookmark(cell,{from,to:from+1});
				if(getTextToggleState(cell,sample,command)!=='on')continue;
			}
			return {...bookmark,...offsets};
		}
	}

	// CodeMirror is externalized: Obsidian supplies its own word segmentation.
	const text=cell.textContent??'',word=EditorState.create({doc:text}).wordAt(bookmark.from);
	if(!word)return null;
	let from=word.from,to=word.to;
	// Text offsets omit BR and block boundaries; a word cannot cross either.
	for(const element of Array.from(cell.querySelectorAll('br,p,div'))){
		const boundary=cell.ownerDocument.createRange();boundary.selectNodeContents(cell);boundary.setEndBefore(element);const start=boundary.toString().length;
		boundary.setEndAfter(element);const end=boundary.toString().length;
		for(const offset of [start,end]){if(offset<=bookmark.from)from=Math.max(from,offset);else to=Math.min(to,offset);}
	}
	return from<to?{...bookmark,from,to}:null;
}
