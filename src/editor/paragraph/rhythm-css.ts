const blockTags = [
	'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'media', 'list-item',
	'separatorless-list-literal', 'blockquote', 'code-block', 'table',
	'thematic-break', 'footnote-definition', 'math-block', 'html-block',
] as const;

export const semanticBlockGapHeight = 'max(0px,calc(max(var(--paraflow-gap-before,var(--paraflow-block-gap,.8em)),var(--paraflow-gap-after,var(--paraflow-block-gap,.8em))) - var(--paraflow-occupied-gap,0px)))';

/** Gap rows use the body font; component interiors never contribute a second outer gap. */
export function semanticBlockRhythmCss(scope: string): string {
	const gapClass = ':is(.paraflow-paragraph-gap-head,.paraflow-block-boundary-gap,.paraflow-container-boundary-gap[data-paraflow-before="code-block"],.paraflow-container-boundary-gap[data-paraflow-after="code-block"],.paraflow-callout-gap[data-paraflow-before="code-block"],.paraflow-callout-gap[data-paraflow-after="code-block"],.paraflow-container-boundary-gap[data-paraflow-after="table"],.paraflow-callout-gap[data-paraflow-after="table"])';
	const gap = `${scope} ${gapClass}`;
	const height = semanticBlockGapHeight;
	return `
${gap}{
 --paraflow-occupied-gap:0px;
 font-size:var(--font-text-size,16px)!important;
 min-height:${height}!important;line-height:${height}!important;padding-block:0!important;
}
${blockTags.map(tag => `${gap}[data-paraflow-before="${tag}"]{--paraflow-gap-before:var(--paraflow-${tag}-margin-bottom,var(--paraflow-block-gap,.8em))}
${gap}[data-paraflow-after="${tag}"]{--paraflow-gap-after:var(--paraflow-${tag}-margin-top,var(--paraflow-block-gap,.8em))}`).join('\n')}
${gap}[data-paraflow-before="p"]{--paraflow-gap-before:var(--paraflow-body-paragraph-gap,var(--paraflow-p-margin-bottom,var(--paraflow-block-gap,.8em)))}
${gap}[data-paraflow-after="p"]{--paraflow-gap-after:var(--paraflow-body-paragraph-gap,var(--paraflow-p-margin-top,var(--paraflow-block-gap,.8em)))}
${gap}[data-paraflow-after="table"]{--paraflow-gap-after:var(--paraflow-table-margin-top,1.1em)}
${gap}[data-paraflow-before="code-block"]{--paraflow-gap-before:var(--paraflow-code-block-margin-bottom,.9375em)}
${gap}[data-paraflow-after="code-block"]{--paraflow-gap-after:var(--paraflow-code-block-margin-top,.9375em)}
${[1, 2, 3, 4, 5, 6].map(level => `${scope} .paraflow-heading-following-line[data-paraflow-heading-before="h${level}"]{
 padding-block-start:max(var(--paraflow-h${level}-margin-bottom,var(--paraflow-block-gap,.8em)),var(--paraflow-p-margin-top,var(--paraflow-block-gap,.8em)))!important;
}`).join('\n')}
`;
}

/** Reading sections own outer spacing; their children retain only internal layout. */
export function readingBlockRhythmCss(scope: string): string {
	const root = `${scope}>.markdown-preview-view>.markdown-preview-sizer`;
	const kinds: ReadonlyArray<readonly [string, string]> = [
		['p', '.el-p'], ...[1,2,3,4,5,6].map(level => [`h${level}`, `.el-h${level}`] as const),
		['list-item', ':is(.el-ul,.el-ol)'], ['blockquote', '.el-blockquote'],
		['blockquote', '.el-div:has(>.callout)'],
		['code-block', '.el-pre'], ['table', ':is(.el-table,.el-div:has(>table))'],
		['thematic-break', '.el-hr'], ['math-block', '.el-div:has(>.math-block)'],
	];
	const section = `:is(${kinds.map(([,selector]) => selector).join(',')})`;
	const listSection = ':is(.el-ul,.el-ol)';
	const edge = (tag: string, side: 'top'|'bottom') => tag === 'p'
		? `var(--paraflow-body-paragraph-gap,var(--paraflow-p-margin-${side},var(--paraflow-block-gap,.8em)))`
		: `var(--paraflow-${tag}-margin-${side},${tag === 'code-block' ? '.9375em' : tag === 'table' && side === 'top' ? '1.1em' : 'var(--paraflow-block-gap,.8em)'})`;
	return `
${root}>${section}{margin-block:0!important;--paraflow-occupied-gap:0px;padding-block-start:0}
${root}>${section}>:is(p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,table,hr,.callout,.math-block){margin-block:0!important}
${root}>${section}+${section}{padding-block-start:${semanticBlockGapHeight}}
${root}>${listSection}:has(+${listSection})>:is(ul,ol) li:last-child:not(:is(li:not(:last-child) *)){padding-block-end:0}
${root}>${listSection}+${listSection}>:is(ul,ol)>li:first-child{--paraflow-list-row-top-padding:0px;padding-block-start:var(--paraflow-list-row-top-padding)}
${kinds.map(([tag,selector]) => `${root}>${selector}{--paraflow-gap-after:${edge(tag,'top')}}
${root}>${selector}+${section}{--paraflow-gap-before:${edge(tag,'bottom')}}`).join('\n')}
`;
}
