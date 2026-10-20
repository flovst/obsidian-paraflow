const blockTags = [
	'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'media', 'list-item',
	'separatorless-list-literal', 'blockquote', 'code-block', 'table',
	'thematic-break', 'footnote-definition', 'math-block', 'html-block',
] as const;

export const semanticBlockGapHeight = 'max(0px,calc(max(var(--paraflow-gap-before,var(--paraflow-block-gap,.8em)),var(--paraflow-gap-after,var(--paraflow-block-gap,.8em))) - var(--paraflow-occupied-gap,0px)))';

/** Gap rows use the body font; component interiors never contribute a second outer gap. */
export function semanticBlockRhythmCss(scope: string): string {
	const gapClass = ':is(.paraflow-paragraph-gap-head,.paraflow-block-boundary-gap,.paraflow-container-boundary-gap[data-paraflow-before="code-block"],.paraflow-container-boundary-gap[data-paraflow-after="code-block"],.paraflow-callout-gap[data-paraflow-before="code-block"],.paraflow-callout-gap[data-paraflow-after="code-block"],.paraflow-container-boundary-gap[data-paraflow-before="table"],.paraflow-callout-gap[data-paraflow-before="table"],.paraflow-container-boundary-gap[data-paraflow-after="table"],.paraflow-callout-gap[data-paraflow-after="table"])';
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
${gap}[data-paraflow-before="media"]{--paraflow-gap-before:var(--paraflow-media-margin-bottom,var(--paraflow-p-margin-bottom,var(--paraflow-block-gap,.8em)))}
${gap}[data-paraflow-after="media"]{--paraflow-gap-after:var(--paraflow-media-margin-top,var(--paraflow-p-margin-top,var(--paraflow-block-gap,.8em)))}
${gap}[data-paraflow-after="table"]{--paraflow-gap-after:var(--paraflow-table-margin-top,1.1em)}
${gap}[data-paraflow-before="table"]{--paraflow-gap-before:var(--paraflow-table-margin-bottom,1.2em)}
${gap}[data-paraflow-before="code-block"]{--paraflow-gap-before:var(--paraflow-code-block-margin-bottom,.9375em)}
${gap}[data-paraflow-after="code-block"]{--paraflow-gap-after:var(--paraflow-code-block-margin-top,.9375em)}
${scope}>.cm-editor>.cm-scroller>.cm-sizer>.cm-contentContainer>.cm-content>.cm-line[data-paraflow-list-sibling-gap]:is(.paraflow-paragraph-gap-head,.paraflow-list-blank-gap-head,.paraflow-callout-gap:not(.paraflow-callout-gap-tail)){
 height:var(--paraflow-list-sibling-gap,var(--paraflow-block-gap,.8em))!important;
 min-height:var(--paraflow-list-sibling-gap,var(--paraflow-block-gap,.8em))!important;
 line-height:var(--paraflow-list-sibling-gap,var(--paraflow-block-gap,.8em))!important;
}
${[1, 2, 3, 4, 5, 6].map(level => `${scope} .paraflow-heading-following-line[data-paraflow-heading-before="h${level}"]{
 padding-block-start:max(var(--paraflow-h${level}-margin-bottom,var(--paraflow-block-gap,.8em)),var(--paraflow-p-margin-top,var(--paraflow-block-gap,.8em)))!important;
}`).join('\n')}
`;
}

/** Reading sections own outer spacing; their children retain only internal layout. */
export function readingBlockRhythmCss(scope: string): string {
	const root = `${scope}>.markdown-preview-view>.markdown-preview-sizer`;
	const projection = '.paraflow-reading-math-section';
	const sectionWith = (child: string) => `.el-div:has(>${child},>${projection}>${child})`;
	const kinds: ReadonlyArray<readonly [string, string]> = [
		['p', '.el-p'], ['media', '.el-p[data-paraflow-reading-kind="media"]'], ...[1,2,3,4,5,6].map(level => [`h${level}`, `.el-h${level}`] as const),
		['list-item', ':is(.el-ul,.el-ol)'], ['blockquote', '.el-blockquote'],
		['blockquote', sectionWith('.callout')],
		['code-block', '.el-pre'], ['table', `:is(.el-table,${sectionWith(':is(table,.paraflow-display-table-viewport)')})`],
		['thematic-break', '.el-hr'], ['math-block', sectionWith('.math-block')],
	];
	const section = `:is(${kinds.map(([,selector]) => selector).join(',')})`;
	// Source adapters add one transparent render owner inside the native section.
	const contentOwner = (selector: string) => `:is(${selector},${selector}>${projection})`;
	const listSection = ':is(.el-ul,.el-ol)';
	const container = `${scope} :is(blockquote.paraflow-display-quote,.callout-content):not(.markdown-embed *)`;
	const listEnd = [`${contentOwner(`${root}>${listSection}[data-paraflow-reading-after="list-item"]`)}>:is(ul,ol)`, `${container}>:is(ul,ol):has(+:is(ul,ol))`];
	const listStart = [`${contentOwner(`${root}>${listSection}[data-paraflow-reading-before="list-item"]`)}>:is(ul,ol)`, `${container}>:is(ul,ol)+:is(ul,ol)`];
	const edge = (tag: string, side: 'top'|'bottom') => tag === 'p'
		? `var(--paraflow-body-paragraph-gap,var(--paraflow-p-margin-${side},var(--paraflow-block-gap,.8em)))`
		: `var(--paraflow-${tag}-margin-${side},${tag === 'code-block' ? '.9375em' : tag === 'table' ? side === 'top' ? '1.1em' : '1.2em' : 'var(--paraflow-block-gap,.8em)'})`;
	const table = ':is(table,.paraflow-display-table-viewport:has(>table))';
	const containerKinds = [
		['p', 'p'], ...[1,2,3,4,5,6].map(level => [`h${level}`, `h${level}`]),
		['code-block', ':is(pre,.paraflow-code-display-frame)'], ['list-item', ':is(ul,ol)'],
		['blockquote', ':is(blockquote,.callout)'], ['math-block', '.math-block'], ['table', table],
		['thematic-break', 'hr'],
	] as const;
	const containerBlock = `:is(${containerKinds.map(([, selector]) => selector).join(',')})`;
	const codeFrame = '.paraflow-code-display-frame';
	const codeNeighbors = ':is(p,.math-block,.paraflow-code-display-frame)';
	return `
${root}>${section}{margin-block:0!important;--paraflow-occupied-gap:0px;padding-block-start:0}
${contentOwner(`${root}>${section}`)}>:is(p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,table,hr,.callout,.math-block,.paraflow-display-table-viewport){margin-block:0!important}
${contentOwner(`${root}>${section}`)}>.paraflow-display-table-viewport>table{margin-block:0!important}
${root}>${section}[data-paraflow-reading-before]:not([data-paraflow-reading-before=""]){padding-block-start:${semanticBlockGapHeight}}
${listEnd.map(selector => `${selector} li:last-child:not(:is(li:not(:last-child) *))`).join(',')}{padding-block-end:0}
${listEnd.map(selector => `${selector}>li:last-child>p:last-child`).join(',')}{margin-block-end:0}
${listStart.map(selector => `${selector}>li:first-child`).join(',')}{--paraflow-list-row-top-padding:0px;padding-block-start:var(--paraflow-list-row-top-padding)}
/* A scroll viewport owns the table's outer gap after display enhancement. */
${container}>.paraflow-display-table-viewport>table{margin-block:0!important}
${container}>${containerBlock}:has(+${table}),${container}>${table}:has(+${containerBlock}),${container}>${codeNeighbors}:has(+${codeFrame}),${container}>${codeFrame}:has(+${codeNeighbors}){margin-block-end:0!important}
${containerKinds.map(([tag,selector]) => `${container}>${selector}+${containerBlock}{--paraflow-container-gap-before:${edge(tag,'bottom')}}
${container}>${tag === 'table' ? containerBlock : table}+${selector}{margin-block-start:max(var(--paraflow-container-gap-before),${edge(tag,'top')})!important}`).join('\n')}
${container}>${codeNeighbors}+${codeFrame}{margin-block-start:max(var(--paraflow-container-gap-before),${edge('code-block','top')})!important}
${(['p','math-block','code-block'] as const).map(tag => `${container}>${codeFrame}+${tag === 'code-block' ? codeFrame : tag === 'p' ? 'p' : '.math-block'}{margin-block-start:max(${edge('code-block','bottom')},${edge(tag,'top')})!important}`).join('\n')}
${container}>.paraflow-code-display-frame>pre{margin-block:0!important}
${kinds.map(([tag,selector]) => `${root}>${selector}{--paraflow-gap-after:${edge(tag,'top')}}
${root}>${section}[data-paraflow-reading-before="${tag}"]{--paraflow-gap-before:${edge(tag,'bottom')}}`).join('\n')}
`;
}
