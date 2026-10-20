import {quotedParagraphTabStarts} from '../editor/callout/body-tab-source.js';

/** Keep body Tabs literal in the transient native render input, never in saved source. */
export function adaptReadingBodyTabSource(source:string):string|null {
 const inserts=quotedParagraphTabStarts(source);
 if(!inserts.length)return null;
 let result=source;
 for(const at of [...inserts].reverse())result=result.slice(0,at)+'\u200b'+result.slice(at);
 return result;
}
