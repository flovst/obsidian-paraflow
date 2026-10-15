export const highlightEmoji={red:'🔴',orange:'🟠',yellow:'🟡',green:'🟢',blue:'🔵',purple:'🟣'} as const;
export type HighlightColor=''|keyof typeof highlightEmoji;

export function isHighlightColor(value:string):value is HighlightColor {return value===''||Object.prototype.hasOwnProperty.call(highlightEmoji,value);}
export function highlightColorPrefix(color:HighlightColor):string {return color?highlightEmoji[color]:'';}
export function decodeHighlightPrefix(source:string):{color:HighlightColor;length:number} {
 for(const [color,emoji] of Object.entries(highlightEmoji))if(source.startsWith(emoji))return {color:color as HighlightColor,length:emoji.length};
 return {color:'',length:0};
}
