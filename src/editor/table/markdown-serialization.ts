import type { SyntaxNode } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';
import { escapeHtml, gridToHtml, htmlToGrid, TableSerializationError, type HtmlTable } from './html-serialization';
import type { TableCell, TableModel } from './model';
import {normalizeInlineNodes} from './inline-semantics';
import {decodeHighlightPrefix,highlightColorPrefix,type HighlightColor} from './highlight';
import {createWikiAnchor,decodeWikiSource,encodeWikiSource,isWikiAnchor,readWikiAnchor} from './wiki-links';
import {ident} from 'css-tree';

const gfmParser = parser.configure(GFM);
const highlightDelimiter={resolve:'PFHighlight',mark:'PFHighlightMark'};

// Lezer's GFM autolink recognizes a suffix only after '/', while Obsidian also
// links query/fragment suffixes immediately after the host. Keep them one URL node.
export const tableMarkdownParser = gfmParser.configure({defineNodes:['PFHighlight','PFHighlightMark','PFWiki'], parseInline: [{
	name:'PFWiki',before:'Link',
	parse(context,next,position){
		if(next!==91||context.char(position+1)!==91)return -1;
		const remaining=context.slice(position,context.end),end=remaining.indexOf(']]');if(end<0)return -1;
		return context.addElement(context.elt('PFWiki',position,position+end+2));
	},
},{
	name:'PFHighlight',before:'Autolink',
	parse(context,next,position){
		if(next!==61||context.char(position+1)!==61||context.char(position-1)===61||context.char(position+2)===61)return -1;
		return context.addDelimiter(highlightDelimiter,position,position+2,!/\s|^$/u.test(context.slice(position+2,position+3)),!/\s|^$/u.test(context.slice(position-1,position)));
	},
},{
	name:'PFHighlightUrl',before:'Autolink',
	parse(context,_next,position){
		if(context.findOpeningDelimiter(highlightDelimiter)===null)return -1;
		const remaining=context.slice(position,context.end),end=remaining.indexOf('==');if(end<0)return -1;
		const text=remaining.slice(0,end),host=/^(?:https?:\/\/|www\.)[\w-]+(?:\.[\w-]+)+(?::\d+)?(?=[?#])/iu.exec(text);
		const candidate=host?`${host[0]}/${text.slice(host[0].length)}`:text;
		const url=gfmParser.parseInline(candidate,0).find(element=>element.from===0&&gfmParser.nodeSet.types[element.type]?.name==='URL');
		if(!url)return -1;return context.addElement(context.elt('URL',position,position+url.to-Number(!!host)));
	},
},{
	name: 'ParaFlowBareUrlSuffix', before: 'Autolink',
	parse(context, _next, position) {
		const offset = position - context.offset;
		if (context.hasOpenLink || offset > 0 && /\w/.test(context.text[offset - 1]!)) return -1;
		const remaining = context.text.slice(offset);
		const match = /^(?:https?:\/\/|www\.)[\w-]+(?:\.[\w-]+)+(?::\d+)?(?=[?#])/i.exec(remaining);
		if (!match) return -1;
		// A synthetic slash lets the existing GFM parser own punctuation, balancing
		// and trailing-entity rules. Remove only that offset from its resulting span.
		const host = match[0].replace(/^(?:https?|www)/i, prefix => prefix.toLowerCase());
		const candidate = `${host}/${remaining.slice(match[0].length)}`;
		const url = gfmParser.parseInline(candidate, 0).find(element => element.from === 0 && gfmParser.nodeSet.types[element.type]?.name === 'URL');
		if (!url) return -1;
		const end = position + url.to - 1;
		return context.addElement(context.elt('URL', position, end));
	},
}] });

const markdownParser=tableMarkdownParser;

function fail(reason: string, row: number, column: number): never {
	throw new TableSerializationError(reason, row + 1, column + 1);
}

function children(node: SyntaxNode): SyntaxNode[] {
	const result: SyntaxNode[] = [];
	for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
	return result;
}

interface MarkdownCell { from: number; to: number; node?: SyntaxNode }

/** Delimiters come from Lezer's table grammar, including its escape rules. */
function rowCells(source: string, row: SyntaxNode): MarkdownCell[] {
	const nodes = children(row);
	const delimiters = nodes.filter(node => node.name === 'TableDelimiter');
	const boundaries = [row.from, ...delimiters.map(node => node.from), row.to];
	const result: MarkdownCell[] = [];
	for (let index = 0; index < boundaries.length - 1; index++) {
		let from = boundaries[index]! + (index > 0 ? 1 : 0);
		let to = boundaries[index + 1]!;
		if ((index === 0 || index === boundaries.length - 2) && !source.slice(from, to).trim() && delimiters.length) continue;
		while (from < to && /\s/.test(source[from]!)) from++;
		while (to > from && /\s/.test(source[to - 1]!)) to--;
		result.push({ from, to, node: nodes.find(node => node.name === 'TableCell' && node.from >= from && node.to <= to) });
	}
	return result;
}

function decodeMarkdownText(source: string): string {
	// One token pass: escaped ampersands and incomplete references remain literal.
	return source.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])|&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g,
		(token, escaped: string | undefined) => {
			if (escaped !== undefined) return escaped;
			// Attribute context forbids legacy partial matches such as &not inside &notit;.
			const doc = new window.DOMParser().parseFromString(`<p title="${token}"></p>`, 'text/html');
			return doc.body.firstElementChild!.getAttribute('title')!;
		});
}

function renderText(text: string, row: number, column: number): string {
	if (/\[\[|\]\]/.test(text)) fail('Wiki links and embeds are not supported', row, column);
	return escapeHtml(text);
}

function renderRange(source: string, from: number, to: number, nodes: SyntaxNode[], row: number, column: number): string {
	let result = '';
	let offset = from;
	for (const node of nodes) {
		if (node.from < from || node.to > to) continue;
		result += renderText(source.slice(offset, node.from), row, column);
		result += renderInline(source, node, row, column);
		offset = node.to;
	}
	return result + renderText(source.slice(offset, to), row, column);
}

function renderLink(source: string, node: SyntaxNode, row: number, column: number): string {
	const nodes = children(node);
	const url = nodes.find(child => child.name === 'URL');
	const marks = nodes.filter(child => child.name === 'LinkMark');
	if (!url || marks.length !== 4) fail('Only inline links with explicit destinations are supported', row, column);
	const label = renderRange(source, marks[0]!.to, marks[1]!.from, nodes, row, column);
	let destination = source.slice(url.from, url.to);
	if (destination.startsWith('<') && destination.endsWith('>')) destination = destination.slice(1, -1);
	const title = nodes.find(child => child.name === 'LinkTitle');
	const titleAttribute = title ? ` title="${escapeHtml(decodeMarkdownText(source.slice(title.from + 1, title.to - 1)))}"` : '';
	return `<a href="${escapeHtml(decodeMarkdownText(destination))}"${titleAttribute}>${label}</a>`;
}

function renderInline(source: string, node: SyntaxNode, row: number, column: number): string {
	const raw = source.slice(node.from, node.to);
	if(node.name==='PFWiki'){
		if(source[node.from-1]==='!'){
			let escapes=0;for(let at=node.from-2;at>=0&&source[at]==='\\';at--)escapes++;
			if(escapes%2===0)fail('Wiki embeds cannot be converted losslessly',row,column);
		}
		let link:ReturnType<typeof decodeWikiSource>;try{link=decodeWikiSource(raw);}catch(error){fail(error instanceof Error?error.message:String(error),row,column);}
		const anchor=createWikiAnchor(document,link);anchor.textContent=link.alias??link.target;return anchor.outerHTML;
	}
	if (node.name === 'Escape') return escapeHtml(raw.slice(1));
	if (node.name === 'Entity') return escapeHtml(decodeMarkdownText(raw));
	if (node.name === 'HTMLTag') return raw.replace(/\\\|/g, '|');
	if (node.name === 'Link') return renderLink(source, node, row, column);
	if (node.name === 'URL' || node.name === 'Autolink') {
		const label = (node.name === 'Autolink' ? raw.slice(1, -1) : raw).replace(/\\\|/g, '|');
		const destination = /^www\./i.test(label) ? `http://${label}` : !/^[\w+.-]+:/.test(label) && label.includes('@') ? `mailto:${label}` : label;
		return `<a href="${escapeHtml(destination)}">${escapeHtml(label)}</a>`;
	}
	if (node.name === 'InlineCode') {
		const marks = children(node);
		let text = source.slice(marks[0]!.to, marks[marks.length - 1]!.from).replace(/\\\|/g, '|').replace(/\n/g, ' ');
		if (text.startsWith(' ') && text.endsWith(' ') && text.trim()) text = text.slice(1, -1);
		return `<code>${escapeHtml(text)}</code>`;
	}
	if(node.name==='PFHighlight'){
		const nodes=children(node),from=nodes[0]!.to,to=nodes[nodes.length-1]!.from;
		const {color,length}=decodeHighlightPrefix(source.slice(from,to));
		return `<mark${color?` data-highlight="${color}"`:''}>${renderRange(source,from+length,to,nodes.slice(1,-1),row,column)}</mark>`;
	}
	const tags: Record<string, string> = { StrongEmphasis: 'strong', Emphasis: 'em', Strikethrough: 's', PFHighlight:'mark' };
	const tag = tags[node.name];
	if (tag) {
		const nodes = children(node);
		return `<${tag}>${renderRange(source, nodes[0]!.to, nodes[nodes.length - 1]!.from, nodes.slice(1, -1), row, column)}</${tag}>`;
	}
	fail(`Unsupported Markdown ${node.name}`, row, column);
}

function rejectUnsupportedExtensions(source: string, entry: MarkdownCell, row: number, column: number, unpaired: Set<string>): void {
	const text = source.slice(entry.from, entry.to).split('');
	const events: { offset: number; kind: 'marker' | 'bare-url'; text: string }[] = [];
	const mask = (node: SyntaxNode): void => {
		if (['InlineCode', 'Escape', 'Entity', 'HTMLTag', 'URL', 'Autolink', 'LinkTitle', 'PFHighlightMark', 'PFWiki'].includes(node.name)) {
			if (node.name === 'URL' && node.parent?.name !== 'Link') events.push({ offset: node.from - entry.from, kind: 'bare-url', text: source.slice(node.from, node.to) });
			text.fill(' ', node.from - entry.from, node.to - entry.from);
		} else children(node).forEach(mask);
	};
	if (entry.node) mask(entry.node);
	const visibleSource = text.join('');
	if (/\$\$[\s\S]*?\$\$|\$(?=\S)[^$]*[^\s$]\$(?!\d)/.test(visibleSource)) fail('Math cannot be converted losslessly', row, column);
	for (const match of visibleSource.matchAll(/%%|==/g)) events.push({ offset: match.index, kind: 'marker', text: match[0] });
	for (const event of events.sort((a, b) => a.offset - b.offset)) {
		// An already open extension keeps precedence over a URL's swallowed closer.
		if (event.kind === 'bare-url') {
			if ([...unpaired].some(marker => event.text.includes(marker))) fail('Obsidian comments and highlights cannot be converted losslessly', row, column);
		} else {
			if (unpaired.has(event.text)) fail('Obsidian comments and highlights cannot be converted losslessly', row, column);
			unpaired.add(event.text);
		}
	}
}

/** Whole-document boundary: extra blocks and every short/long row are rejected. */
export function markdownToHtml(markdown: string): string {
	const source = markdown.replace(/^(?:[\t ]*\r?\n)+|(?:\r?\n[\t ]*)+$/g, '');
	const root = markdownParser.parse(source).topNode;
	const tableNode = root.firstChild;
	if (!tableNode || tableNode.name !== 'Table' || tableNode.nextSibling || tableNode.from !== 0 || tableNode.to !== source.length) fail('Expected exactly one complete Markdown pipe table', 0, 0);
	const nodes = children(tableNode);
	const header = nodes[0]!;
	const separator = nodes[1]!;
	const headers = rowCells(source, header);
	// Separator syntax has no nested content; delimiters are literal here.
	let separatorText = source.slice(separator.from, separator.to).trim();
	if (separatorText.startsWith('|')) separatorText = separatorText.slice(1);
	if (separatorText.endsWith('|')) separatorText = separatorText.slice(0, -1);
	const markers = separatorText.split('|').map(value => value.trim());
	if (markers.length !== headers.length || markers.some(value => !/^:?-+:?$/.test(value))) fail('Invalid alignment separator', 0, 0);
	const alignments = markers.map(value => value.startsWith(':') ? (value.endsWith(':') ? 'center' : 'left') : (value.endsWith(':') ? 'right' : ''));
	const cells: TableCell[] = [];
	const unpairedExtensions = new Set<string>();
	const rows = [header, ...nodes.slice(2)];
	for (const [row, rowNode] of rows.entries()) {
		const entries = rowCells(source, rowNode);
		if (entries.length !== headers.length) fail('Row width differs from the header', row, Math.min(entries.length, headers.length));
		for (const [column, entry] of entries.entries()) {
			rejectUnsupportedExtensions(source, entry, row, column, unpairedExtensions);
			const html = renderRange(source, entry.from, entry.to, entry.node ? children(entry.node) : [], row, column);
			const alignment = alignments[column]!;
			cells.push({ row, column, rowSpan: 1, columnSpan: 1, role: row === 0 ? 'th' : 'td', html, attributes: {}, style: alignment ? { 'text-align': alignment } : {} });
		}
	}
	const table: TableModel = { rows: rows.length, columns: headers.length, cells };
	return gridToHtml(table);
}

function markdownText(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/[\\`*_[\]{}()!#+\-.|~$%=]/g, '\\$&').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')
		.replace(/^ +| +$/g, spaces => '&#32;'.repeat(spaces.length));
}

const formatAliases: Record<string, string> = { b: 'strong', i: 'em', del: 's' };

function mergeableFormat(node: Node): string | undefined {
	if (node.nodeType !== 1) return undefined;
	const element = node as Element;
	const tag = formatAliases[element.localName] ?? element.localName;
	return !element.attributes.length && ['strong', 'em', 's', 'u'].includes(tag) ? tag : undefined;
}

function markdownNodes(nodes: Node[], row: number, column: number, marker = '*', literalFormats=false): string {
	let result = '';
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index]!;
		const tag = mergeableFormat(node);
		const content = Array.from(node.childNodes);
		while (tag && index + 1 < nodes.length && mergeableFormat(nodes[index + 1]!) === tag) content.push(...Array.from(nodes[++index]!.childNodes));
		result += inlineMarkdown(node, row, column, marker, content,literalFormats);
	}
	return result;
}

function inlineMarkdown(node: Node, row: number, column: number, marker: string, childNodes: Node[],literalFormats=false): string {
	if (node.nodeType === 3) return markdownText(node.textContent ?? '');
	if (node.nodeType !== 1) fail('Unsupported inline node', row, column);
	const element = node as Element;
	const tag = element.localName;
	const wiki=isWikiAnchor(element);
	if (Array.from(element.attributes).some(attribute => wiki?!['class','data-href','href','data-pf-wiki-alias'].includes(attribute.name):tag==='mark'?attribute.name!=='data-highlight':tag !== 'a' || !['href', 'title'].includes(attribute.name))) fail('Inline attributes cannot be expressed in Markdown', row, column);
	if (tag === 'br') return '<br>';
	if (tag === 'code') {
		const text = element.textContent ?? '';
		if (!text || /[\r\n]/.test(text)) fail('Empty or multiline code cannot be expressed losslessly', row, column);
		if(literalFormats)return `<code>${markdownText(text)}</code>`;
		const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(value => value.length));
		const fence = '`'.repeat(longest + 1);
		const padding = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim()) ? ' ' : '';
		return `${fence}${padding}${text.replace(/\|/g, '\\|')}${padding}${fence}`;
	}
	const emphasis = ['strong', 'b', 'em', 'i'].includes(tag);
	const content = markdownNodes(childNodes, row, column, emphasis ? (marker === '*' ? '_' : '*') : marker,literalFormats);
	if(tag==='mark'){
		const color=(element.getAttribute('data-highlight')??'') as HighlightColor;
		const adjacentMark=[node.previousSibling,node.nextSibling].some(sibling=>sibling?.nodeType===1&&(sibling as Element).localName==='mark');
		if(literalFormats||adjacentMark||!color&&decodeHighlightPrefix(element.textContent??'').length)return `<mark${color?` data-highlight="${color}"`:''}>${content}</mark>`;
		return `==${highlightColorPrefix(color)}${content}==`;
	}
	const marks: Record<string, string> = { strong: marker.repeat(2), b: marker.repeat(2), em: marker, i: marker, s: '~~', del: '~~', mark:'==' };
	if(literalFormats&&marks[tag])return `<${tag}>${content}</${tag}>`;
	const touchesWord = node.previousSibling?.nodeType === 3 && /\S$/.test(node.previousSibling.textContent ?? '')
		|| node.nextSibling?.nodeType === 3 && /^\S/.test(node.nextSibling.textContent ?? '');
	// Markdown flanking rules cannot represent every nested intraword combination.
	if (emphasis && touchesWord && element.querySelector('strong, b, em, i')) return `<${tag}>${content}</${tag}>`;
	if (marks[tag]) return `${marks[tag]}${content}${marks[tag]}`;
	if (tag === 'u') return `<u>${content}</u>`;
	if (tag === 'a') {
		if(wiki){
			if(childNodes.some(child=>child.nodeType!==3))return `<a class="internal-link" data-href="${escapeHtml(element.getAttribute('data-href')!)}" href="${escapeHtml(element.getAttribute('href')!)}"${element.hasAttribute('data-pf-wiki-alias')?' data-pf-wiki-alias="true"':''}>${content}</a>`;
			return encodeWikiSource(readWikiAnchor(element));
		}
		const href = element.getAttribute('href');
		if (href === null || /[\r\n<>]/.test(href)) fail('Link destination cannot be expressed losslessly', row, column);
		const escapeDestination = (value: string): string => value.replace(/&/g, '&amp;').replace(/[\\|]/g, '\\$&').replace(/"/g, '&quot;');
		const title = element.getAttribute('title');
		if (title !== null && /[\r\n]/.test(title)) fail('Multiline link title cannot be expressed losslessly', row, column);
		return `[${content}](<${escapeDestination(href)}>${title !== null ? ` "${escapeDestination(title)}"` : ''})`;
	}
	fail(`Inline ${tag} cannot be expressed in Markdown`, row, column);
}

function contentNodes(html: string): Node[] {
	const doc = new window.DOMParser().parseFromString(`<table><tr><td>${html}</td></tr></table>`, 'text/html');
	const cell = doc.querySelector('td')!;
	const nodes = Array.from(cell.childNodes);
	if (nodes.length === 1 && nodes[0]!.nodeType === 1 && (nodes[0] as Element).localName === 'p' && !(nodes[0] as Element).attributes.length) return Array.from(nodes[0]!.childNodes);
	return nodes;
}

/** Checks the actual rendered result, catching ambiguous emphasis, code and link delimiters. */
function contentSignature(nodes: Node[]): string {
	const result: string[] = [];
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index]!;
		if (node.nodeType === 3) {
			let text = node.textContent ?? '';
			while (index + 1 < nodes.length && nodes[index + 1]!.nodeType === 3) text += nodes[++index]!.textContent ?? '';
			result.push(JSON.stringify(text));
			continue;
		}
		const element = node as Element;
		const tag = mergeableFormat(node);
		const content = Array.from(node.childNodes);
		while (tag && index + 1 < nodes.length && mergeableFormat(nodes[index + 1]!) === tag) content.push(...Array.from(nodes[++index]!.childNodes));
		const attributes = Array.from(element.attributes).map(attr => [attr.name, attr.value]).sort((a, b) => a[0]!.localeCompare(b[0]!));
		result.push(JSON.stringify([formatAliases[element.localName] ?? element.localName, attributes, contentSignature(content)]));
	}
	return result.join('');
}

type MarkdownTableLayout='compact'|'native';
export function htmlToMarkdown(html: string,layout:MarkdownTableLayout='compact'): string {
	return renderMarkdownTable(htmlToGrid(html),layout);
}

function inheritedCellFormats(cell:TableCell):{bold:boolean;italic:boolean} {
	const weight=ident.decode((cell.style['font-weight']??(cell.role==='th'?'bold':'normal')).replace(/\s*!important\s*$/iu,'').trim()).toLowerCase();
	const style=ident.decode((cell.style['font-style']??'normal').replace(/\s*!important\s*$/iu,'').trim()).toLowerCase();
	return {bold:weight==='bold'||Number(weight)===700,italic:style==='italic'};
}

function renderMarkdownTable({table,rowGroups}:HtmlTable,layout:MarkdownTableLayout='compact',literalCells:ReadonlySet<string>=new Set(),onInlineLoss?:(cell:TableCell)=>void):string {
	const representableGroups = rowGroups.length === 1 && rowGroups[0]!.kind === 'tbody'
		|| rowGroups.length <= 2 && rowGroups[0]!.kind === 'thead' && rowGroups[0]!.rowCount === 1 && (rowGroups.length === 1 || rowGroups[1]!.kind === 'tbody');
	if (!representableGroups) fail('Row-group semantics cannot be expressed in Markdown', 0, 0);
	const rows: string[][] = Array.from({ length: table.rows }, () => []);
	const alignments: string[] = [];
	for (const cell of table.cells) {
		const { row, column } = cell;
		if (cell.rowSpan !== 1 || cell.columnSpan !== 1) fail('Merged cells cannot be expressed in Markdown', row, column);
		if (cell.role !== (row === 0 ? 'th' : 'td')) fail('Markdown requires a complete header row followed by body cells', row, column);
		if (Object.keys(cell.attributes).length) fail('Cell attributes cannot be expressed in Markdown', row, column);
		if (Object.keys(cell.style).some(property => property !== 'text-align')) fail('Cell styles cannot be expressed in Markdown', row, column);
		const alignment = cell.style['text-align'] ?? '';
		if (!['', 'left', 'center', 'right'].includes(alignment)) fail('Unsupported alignment', row, column);
		if (row === 0) alignments[column] = alignment;
		else if (alignments[column] !== alignment) fail('Column alignment differs between cells', row, column);
		rows[row]![column] = markdownNodes(normalizeInlineNodes(contentNodes(cell.html),row,column,undefined,inheritedCellFormats(cell)), row, column,'*',literalCells.has(`${row}:${column}`));
	}
	const markers: Record<string, string> = { '': '---', left: ':---', center: ':---:', right: '---:' };
	// Native cell activation normalizes source widths. Emit that stable layout in
	// the action itself so host padding cannot become a separate Undo event.
	const widths=alignments.map((_,column)=>rows.reduce((width,row)=>Math.max(width,row[column]!.length),3));
	const lines = rows.map(row => `| ${row.map((text,column)=>{
		if(layout==='compact')return text;
		const remaining=widths[column]!-text.length,alignment=alignments[column];
		const left=alignment==='right'?remaining:alignment==='center'?Math.floor(remaining/2):0;
		return ' '.repeat(left)+text+' '.repeat(remaining-left);
	}).join(' | ')} |`);
	lines.splice(1, 0, `| ${alignments.map((alignment,column)=>{
		if(layout==='compact')return markers[alignment];
		const left=alignment==='left'||alignment==='center',right=alignment==='right'||alignment==='center';
		return (left?':':'')+'-'.repeat(widths[column]!-Number(left)-Number(right))+(right?':':'');
	}).join(' | ')} |`);
	const markdown = lines.join('\n');
	const roundTrip = htmlToGrid(markdownToHtml(markdown)).table;
	for (const cell of table.cells) {
		const result = roundTrip.cells.find(other => other.row === cell.row && other.column === cell.column)!;
		if (contentSignature(normalizeInlineNodes(contentNodes(cell.html),cell.row,cell.column,undefined,inheritedCellFormats(cell))) !== contentSignature(normalizeInlineNodes(contentNodes(result.html),cell.row,cell.column,undefined,inheritedCellFormats(result)))) {
			if(onInlineLoss)onInlineLoss(cell);else fail('Inline content has no lossless Markdown representation', cell.row, cell.column);
		}
	}
	return markdown;
}

export interface TableConversionLoss {
	readonly category: 'header'|'row-role'|'row-group'|'merged-cells'|'cell-attribute'|'cell-style'|'alignment'|'inline-attribute'|'inline-element'|'inline-content';
	/** Locations refer to the original logical grid, before an empty header is added. */
	readonly row:number;
	readonly column:number;
	readonly message:string;
}
export interface TableMarkdownPlan {readonly markdown:string;readonly losses:readonly TableConversionLoss[];readonly headerAdded:boolean;}

/** Force conversion is available only after the ordinary editable HTML boundary admits the source. */
export function planHtmlToMarkdown(html:string,layout:MarkdownTableLayout='compact'):TableMarkdownPlan {
	const {table,rowGroups}=htmlToGrid(html);
	try{return {markdown:htmlToMarkdown(html,layout),losses:[],headerAdded:false};}catch(error){if(!(error instanceof TableSerializationError))throw error;}
	const losses:TableConversionLoss[]=[];
	const literalCells=new Set<string>();
	const report=(category:TableConversionLoss['category'],row:number,column:number,message:string)=>losses.push({category,row:row+1,column:column+1,message});
	const headerAdded=table.cells.some(cell=>cell.row===0&&cell.role!=='th');
	if(headerAdded)report('header',0,0,'表格没有完整的表头行。将新增一行空表头，保留全部原始数据行。');
	const representableGroups=rowGroups.length===1&&rowGroups[0]!.kind==='tbody'||rowGroups.length<=2&&rowGroups[0]!.kind==='thead'&&rowGroups[0]!.rowCount===1&&(rowGroups.length===1||rowGroups[1]!.kind==='tbody');
	if(!representableGroups)for(const group of rowGroups)report('row-group',group.startRow,0,`${group.kind} 分组（${group.rowCount} 行）将转换为普通 Markdown 行。`);
	const alignments=Array.from({length:table.columns},(_,column)=>{
		const entries=table.cells.filter(cell=>cell.column<=column&&cell.column+cell.columnSpan>column);
		const alignment=entries[0]!.style['text-align']??'';
		return ['', 'left','center','right'].includes(alignment)&&entries.every(cell=>(cell.style['text-align']??'')===alignment)?alignment:'';
	});
	const normalize=(nodes:Node[],row:number,column:number):string=>nodes.map(node=>{
		if(node.nodeType===3)return escapeHtml(node.textContent??'');
		const element=node as Element,tag=element.localName;
		const content=normalize(Array.from(element.childNodes),row,column);
		if(tag==='code'&&(!element.textContent||/[\r\n]/.test(element.textContent))){report('inline-content',row,column,'将移除空代码或多行行内代码的格式。');return content;}
		// Pipe-table delimiters count preceding backslashes even inside code fences.
		if(tag==='code'&&Array.from((element.textContent??'').matchAll(/\\+\|/g)).some(match=>(match[0].length-1)%2===1)){
			literalCells.add(`${row+offset}:${column}`);report('inline-content',row,column,'代码中的竖线前有奇数个反斜杠，无法使用 Markdown 行内代码标记；将使用 HTML <code> 标签保留内容。');
		}
		if(tag==='a'){
			if(isWikiAnchor(element))return `<a class="internal-link" data-href="${escapeHtml(element.getAttribute('data-href')!)}" href="${escapeHtml(element.getAttribute('href')!)}"${element.hasAttribute('data-pf-wiki-alias')?' data-pf-wiki-alias="true"':''}>${content}</a>`;
			const href=element.getAttribute('href'),title=element.getAttribute('title');
			if(href===null||/[\r\n<>]/.test(href)){report('inline-content',row,column,'链接地址无法转换；将保留链接文字，移除链接。');return content;}
			if(title!==null&&/[\r\n]/.test(title))report('inline-attribute',row,column,'将移除多行链接标题。');
			return `<a href="${escapeHtml(href)}"${title!==null&&!/[\r\n]/.test(title)?` title="${escapeHtml(title)}"`:''}>${content}</a>`;
		}
		return tag==='br'?'<br>':`<${tag}${tag==='mark'&&element.hasAttribute('data-highlight')?` data-highlight="${element.getAttribute('data-highlight')}"`:''}>${content}</${tag}>`;
	}).join('');
	const offset=headerAdded?1:0;
	const cells:TableCell[]=Array.from({length:(table.rows+offset)*table.columns},(_,index):TableCell=>{
		const row=Math.floor(index/table.columns),column=index%table.columns;
		return {row,column,rowSpan:1,columnSpan:1,role:row===0?'th':'td',html:'',attributes:{},style:alignments[column]?{'text-align':alignments[column]}:{}};
	});
	for(const cell of table.cells){
		const {row,column}=cell;
		if(cell.rowSpan!==1||cell.columnSpan!==1)report('merged-cells',row,column,`将拆分跨 ${cell.rowSpan} 行、${cell.columnSpan} 列的合并单元格。内容仅保留在左上角位置，其余覆盖位置留空。`);
		if(cell.role!==(row+offset===0?'th':'td'))report('row-role',row,column,`${cell.role} 单元格将转换为${row+offset===0?'表头':'正文'}单元格。`);
		for(const [name,value] of Object.entries(cell.attributes))report('cell-attribute',row,column,`将移除单元格属性 ${name}="${value}"。`);
		for(const [name,value] of Object.entries(cell.style))if(name!=='text-align')report('cell-style',row,column,`将移除单元格样式 ${name}: ${value}。`);
		if((cell.style['text-align']??'')!==alignments[column])report('alignment',row,column,`单元格对齐方式 ${cell.style['text-align']} 与所在列不一致，将被移除。`);
		cells[(row+offset)*table.columns+column]={...cells[(row+offset)*table.columns+column]!,html:normalize(normalizeInlineNodes(contentNodes(cell.html),row,column,(category,message)=>report(category,row,column,message),inheritedCellFormats(cell)),row,column)};
	}
	const normalized={rows:table.rows+offset,columns:table.columns,cells};
	// Collect every inline mismatch through the same round-trip authority. Supported
	// emphasis may retain literal HTML tags when Markdown delimiters are ambiguous.
	let failed:TableCell[]=[];
	let markdown=renderMarkdownTable(htmlToGrid(gridToHtml(normalized)),layout,literalCells,cell=>failed.push(cell));
	if(!failed.length)return {markdown,losses,headerAdded};
	for(const cell of failed){literalCells.add(`${cell.row}:${cell.column}`);report('inline-content',cell.row-offset,cell.column,'格内格式无法使用 Markdown 标记无损表示；支持的强调格式将使用 HTML 行内标签保留。');}
	failed=[];markdown=renderMarkdownTable(htmlToGrid(gridToHtml(normalized)),layout,literalCells,cell=>failed.push(cell));
	if(!failed.length)return {markdown,losses,headerAdded};
	const text=(nodes:Node[]):string=>nodes.map(node=>node.nodeType===3?node.textContent??'':(node as Element).localName==='br'?'\n':text(Array.from(node.childNodes))).join('');
	for(const cell of failed){
		report('inline-content',cell.row-offset,cell.column,'格内内容无法无损转换为 Markdown；将移除此单元格其余的行内格式，保留文字。');
		cells[cell.row*table.columns+cell.column]={...cell,html:escapeHtml(text(contentNodes(cell.html)))};
	}
	return {markdown:renderMarkdownTable(htmlToGrid(gridToHtml(normalized)),layout,literalCells),losses,headerAdded};
}

/** Keep all untouched Markdown bytes; only edited cell content is serialized. */
export function rewriteMarkdownCellContents(source:string,before:TableModel,after:TableModel):string {
	if(before.rows!==after.rows||before.columns!==after.columns)throw new Error('Cell content edits cannot change table dimensions.');
	const generated=htmlToMarkdown(gridToHtml(after));
	const spans=(text:string)=>children(markdownParser.parse(text).topNode.firstChild!).filter(node=>node.name==='TableHeader'||node.name==='TableRow').flatMap(row=>rowCells(text,row));
	const original=spans(source),replacement=spans(generated);
	let result=source;
	for(let index=before.cells.length-1;index>=0;index--){
		if(before.cells[index]!.html===after.cells[index]!.html)continue;
		const from=original[index]!,to=replacement[index]!;result=result.slice(0,from.from)+generated.slice(to.from,to.to)+result.slice(from.to);
	}
	return result;
}
