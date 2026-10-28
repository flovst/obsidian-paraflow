import * as css from 'css-tree';

export const contentExclusion = ':not(:is(.callout,.callout *,.markdown-embed,.markdown-embed *))';
const tags = new Set('p h1 h2 h3 h4 h5 h6 a strong b em i del s mark code kbd pre blockquote table thead tbody tfoot caption colgroup col tr th td img hr ul ol li span dl dt dd tt q sup sub abbr'.split(' '));
export const tableTags = new Set('table thead tbody tfoot caption colgroup col tr th td'.split(' '));
const classes = new Set(['md-fences', 'md-inline-code', 'footnotes']);
const pseudoClasses = new Set(['hover', 'focus', 'active', 'first-child', 'last-child', 'nth-child', 'nth-of-type']);

export interface SelectorMapping {
	root: boolean;
	rootKind?: 'html' | 'body' | 'write';
	reading: string;
	live: string[];
	tag: string;
	marker: boolean;
	complex: boolean;
}

/** Accept a small selector vocabulary; never broaden unsupported compound selectors. */
export function mapSelector(selector: css.Selector): SelectorMapping | null {
	const nodes = selector.children.toArray();
	let root = true;
	let marker = false;
	let tag = '';
	let complex = false;
	let rootKind: SelectorMapping['rootKind'];
	const retained: css.CssNode[] = [];
	for (const node of nodes) {
		if (root && ((node.type === 'IdSelector' && node.name === 'write') ||
			(node.type === 'TypeSelector' && ['html', 'body'].includes(node.name)) ||
			(node.type === 'PseudoClassSelector' && node.name === 'root'))) {
			rootKind = node.type === 'IdSelector' ? 'write' : node.name === 'body' ? 'body' : 'html';
			continue;
		}
		if (node.type === 'Combinator') {
			if (retained.length === 0) { if (node.name === ' ') continue; return null; }
			if (![' ', '>', '+', '~'].includes(node.name)) return null;
			complex = true;
		} else if (node.type === 'TypeSelector') {
			if (!tags.has(node.name)) return null;
			tag = node.name;
		} else if (node.type === 'ClassSelector') {
			if (node.name === 'footnotes' && (!retained.length || retained.at(-1)?.type === 'Combinator')) {
				tag = 'footnotes'; retained.push(node);
			} else if (node.name === 'md-meta-block' && retained.at(-1)?.type === 'TypeSelector' && tag === 'pre') {
				tag = 'metadata';
			} else if (node.name === 'md-fences' && retained.at(-1)?.type === 'TypeSelector' && tag === 'pre') {
				// pre.md-fences is Typora's usual code block selector.
			} else {
				if (!classes.has(node.name) || (retained.length && retained.at(-1)?.type !== 'Combinator')) return null;
				tag = node.name === 'md-fences' ? 'pre' : 'code';
				retained.push({ type: 'TypeSelector', name: tag });
			}
			root = false;
			continue;
		} else if (node.type === 'PseudoElementSelector') {
			if (node.name !== 'marker') return null;
			marker = true;
			continue;
		} else if (node.type === 'PseudoClassSelector') {
			if (root) return null;
			if (!pseudoClasses.has(node.name)) return null;
			complex = true;
		} else return null;
		root = false;
		retained.push(node);
	}
	if (root) return { root: true, rootKind, reading: '', live: [''], tag: 'body', marker: false, complex: false };
	if (!tag || retained.at(-1)?.type === 'Combinator') return null;
	if (marker && tag !== 'li') return null;
	const retainedSelector = css.generate({ type: 'Selector', children: new css.List<css.CssNode>().fromArray(retained) });
	const reading = retainedSelector + contentExclusion + (marker ? '::marker' : '');
	let live: string[] = [];
	if (tableTags.has(tag) && retained.every(node => node.type !== 'TypeSelector' || tableTags.has(node.name))) live = [retainedSelector];
	else if (tag === 'a' && retained.every(node => node.type === 'TypeSelector' || (node.type === 'PseudoClassSelector' && ['hover', 'focus', 'active'].includes(node.name)))) {
		const suffix = retained.filter(node => node.type === 'PseudoClassSelector').map(node => css.generate(node)).join('');
		live = [`.cm-link${suffix}`, `.cm-url${suffix}`];
	}
	if (!complex && !marker) {
		if (/^h[1-6]$/.test(tag)) live = [`.HyperMD-header-${tag.slice(1)}`, `.cm-header-${tag.slice(1)}`];
		else live = ({
			p: [], a: ['.cm-link', '.cm-url'], strong: ['.cm-strong'], b: ['.cm-strong'],
			em: ['.cm-em'], i: ['.cm-em'], del: ['.cm-strikethrough'], s: ['.cm-strikethrough'],
			mark: ['.cm-highlight'], code: ['.cm-inline-code'], kbd: ['kbd'], pre: ['.HyperMD-codeblock'],
			blockquote: ['.HyperMD-quote'], img: ['img'], hr: ['hr'], ul: [], ol: [], li: [], span: [],
			table: ['table'], thead: ['thead'], tbody: ['tbody'], tr: ['tr'], th: ['th'], td: ['td'],
		} as Record<string, string[]>)[tag] ?? [];
	}
	return { root: false, reading, live: live.map(value => value + contentExclusion), tag, marker, complex };
}

export const textProperties = new Set('color font-family font-size font-weight font-style font-variant line-height letter-spacing word-spacing text-align text-decoration text-decoration-color text-decoration-line text-decoration-style text-transform text-shadow'.split(' '));
export const paintProperties = new Set('background background-color background-image background-size background-position background-repeat border border-color border-style border-width border-top border-bottom border-left border-right border-radius border-collapse border-spacing box-shadow opacity'.split(' '));
export const blockProperties = new Set('margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left width min-width max-width height min-height max-height vertical-align overflow overflow-x overflow-y white-space word-break overflow-wrap'.split(' '));
export const rootTokens: Record<string, string[]> = {
	'font-family': ['--paraflow-content-font', '--font-text-theme'],
	'font-size': ['--paraflow-content-font-size', '--font-text-size'],
	'font-weight': ['--paraflow-content-weight'],
	'line-height': ['--paraflow-content-line-height', '--paraflow-line-height', '--line-height-normal'],
	color: ['--paraflow-content-color', '--text-normal'],
	'background-color': ['--paraflow-content-background', '--background-primary'],
	'max-width': ['--paraflow-content-width', '--file-line-width'],
};
