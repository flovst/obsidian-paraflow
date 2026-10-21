import * as css from 'css-tree';
import { validateRelativePath, validateThemeId } from './store.js';
import { themeRoots } from './appearance.js';
import type { ThemeOverrides } from './appearance.js';
import type { ThemeManifest } from './model.js';
import { semanticBlockRhythmCss, readingBlockRhythmCss } from '../editor/paragraph/rhythm-css.js';
import { projectHeadingThemeSelectors } from './heading-selectors.js';
import { projectSourceThemeTokens } from './width-selectors.js';
import { isolateDiagramParagraphs, projectContentThemeSelectors, projectLinkAccentOverride } from './content-selectors.js';
import { projectQuoteThemeTokens } from './quote-selectors.js';
import { themeResource } from './resource-policy.js';

export function resolveThemeUrls(source: string, resourcePath: (path: string) => string): string {
	const ast = css.parse(source, { parseCustomProperty: true, onParseError(error) { throw error; } });
	css.walk(ast, node => {
		const resource = themeResource(node);
		if (resource && 'kind' in resource) {
			if (resource.kind === 'import') throw new Error('Theme CSS must contain no runtime imports');
			throw new Error(`Unsupported theme resource function: ${resource.name}`);
		}
		if (!resource || resource.value.startsWith('data:')) return;
		const match = /^([^?#]*)(.*)$/u.exec(resource.value)!;
		const path = validateRelativePath(decodeURIComponent(match[1]!));
		if (!path.startsWith('assets/')) throw new Error(`Theme URL must be inside assets/: ${path}`);
		resource.value = resourcePath(path) + match[2]!;
	});
	projectHeadingThemeSelectors(ast);
	projectContentThemeSelectors(ast);
	projectQuoteThemeTokens(ast);
	projectSourceThemeTokens(ast);
	isolateDiagramParagraphs(ast);
	projectLinkAccentOverride(ast);
	return css.generate(ast);
}

export function contentTokenBridge(id: string, overrides: ThemeOverrides = {}, origin?: ThemeManifest['origin']): string {
 const {body,live,source,reading,roots,widthRoots} = themeRoots(id);
 const exclude = ':not(:is(.callout,.callout *,.markdown-embed,.markdown-embed *))';
 return `
${body}{
 --paraflow-host-font:var(--font-text); --paraflow-host-size:var(--font-text-size); --paraflow-host-weight:var(--font-weight);
 --paraflow-host-width:var(--file-line-width); --paraflow-host-line-height:var(--line-height-normal);
 --paraflow-host-accent:var(--interactive-accent);
}
${widthRoots}{
 --paraflow-text-width:calc(var(--paraflow-content-width,var(--paraflow-host-content-width)) - var(--paraflow-page-padding-left,0px) - var(--paraflow-page-padding-right,0px));
 --paraflow-host-content-width:none;
}
${source}{--paraflow-width-font-size:var(--paraflow-host-size)}
${roots},${source}{
 ${origin === 'imported' ? '--paraflow-default-strong-weight:700;--paraflow-default-footnote-size:calc(.9 * var(--paraflow-root-font-size,var(--font-text-size)));' : ''}
 --paraflow-line-height:var(--paraflow-paragraph-line-height,var(--paraflow-content-line-height,var(--paraflow-host-line-height)));
}
${roots},${source}{
 --font-text:var(--paraflow-paragraph-font,var(--paraflow-content-font,var(--paraflow-host-font)));
 --font-text-size:var(--paraflow-paragraph-size,var(--paraflow-content-font-size,var(--paraflow-host-size)));
 --link-color:var(--paraflow-link-color,var(--paraflow-host-accent));
 --link-external-color:var(--link-color);
 --tag-color:var(--link-color);--tag-color-hover:var(--link-color);
 --tag-background:color-mix(in oklch,var(--link-color) 10%,transparent);
 --tag-background-hover:color-mix(in oklch,var(--link-color) 20%,transparent);
 --tag-border-color:color-mix(in oklch,var(--link-color) 15%,transparent);
 --tag-border-color-hover:color-mix(in oklch,var(--link-color) 30%,transparent);
 --table-header-color:var(--paraflow-content-color,var(--text-normal));
 font-family:var(--font-text); font-size:var(--font-text-size);
 color:var(--paraflow-content-color,var(--text-normal));
 background-color:var(--paraflow-content-background,var(--background-primary));
 caret-color:var(--paraflow-content-color,var(--text-normal));
}
${source}{--paraflow-source-font:var(--font-text)}
${live}.is-readable-line-width,${source}.is-readable-line-width,${reading}:has(.markdown-preview-view.is-readable-line-width){--paraflow-host-content-width:var(--paraflow-host-width)}
${source}>.cm-editor>.cm-scroller>.cm-sizer{max-width:none;width:100%}
${source}>.cm-editor>.cm-scroller>.cm-sizer>.cm-contentContainer>.cm-content{
 max-width:var(--paraflow-text-width);margin-inline:auto;
}
${reading}>.markdown-preview-view,${live}>.cm-editor>.cm-scroller,${source}>.cm-editor>.cm-scroller{
 font-family:var(--font-text);font-size:var(--font-text-size);
 color:var(--paraflow-content-color,var(--text-normal));
}
${reading}>.markdown-preview-view{background-color:var(--paraflow-content-background,var(--background-primary))}
${live}>.cm-editor>.cm-scroller>.cm-sizer>.cm-contentContainer>.cm-content{
 font-family:var(--font-text);font-size:var(--font-text-size);
 font-weight:var(--paraflow-paragraph-weight,var(--paraflow-content-weight,400));
 line-height:var(--paraflow-line-height);
 max-width:var(--paraflow-text-width);margin-inline:auto;
}
${source}>.cm-editor>.cm-scroller>.cm-sizer>.cm-contentContainer>.cm-content{
 font-family:var(--font-text);font-size:var(--font-text-size);
 font-weight:var(--paraflow-paragraph-weight,var(--paraflow-content-weight,400));
 line-height:var(--paraflow-line-height);
 color:var(--paraflow-content-color,var(--text-normal));
}
${reading}>.markdown-preview-view>.markdown-preview-sizer{
 font-weight:var(--paraflow-paragraph-weight,var(--paraflow-content-weight,400));
 max-width:var(--paraflow-text-width);margin-inline:auto;
}
/* The outside input row participates in the page's single terminal-clearance budget. */
${live}:not(.markdown-embed *)>.cm-editor>.cm-scroller,
${reading}:not(.markdown-embed *):not(.cm-table-widget *)>.markdown-preview-view{
 padding-bottom:0!important;
}
${live}:not(.markdown-embed *)>.cm-editor>.cm-scroller>.cm-sizer>.cm-contentContainer>.cm-content,
${reading}:not(.markdown-embed *):not(.cm-table-widget *)>.markdown-preview-view>.markdown-preview-sizer{
 padding-bottom:120px!important;
}
${live}:not(.markdown-embed *)>.cm-editor>.cm-scroller>.cm-sizer>.cm-contentContainer>.cm-content{
 /* Match the Reading renderer's stable fractional pusher origin. */
 padding-top:.1px!important;
}
${live}:not(.markdown-embed *)>.cm-editor>.cm-scroller>.cm-sizer>.cm-contentContainer>.cm-content:has(>.paraflow-virtual-tail){
 padding-bottom:0!important;
}
${live}:not(.markdown-embed *)>.cm-editor>.cm-scroller>.cm-sizer>.cm-contentContainer>.cm-content>.paraflow-virtual-tail{
 min-height:120px!important;
}
${reading} p${exclude}{
 font-family:var(--font-text);font-size:var(--font-text-size);
 font-weight:var(--paraflow-paragraph-weight,var(--paraflow-content-weight,400));
 line-height:var(--paraflow-line-height);
}
${reading} blockquote.paraflow-display-quote > *:not(.markdown-embed){margin-block:0}
${reading} blockquote.paraflow-display-quote > * + *:not(.markdown-embed){margin-block-start:var(--paraflow-callout-gap,calc(.8 * var(--font-text-size,1rem)))}
${reading} :is(ul,ol)>li:has(+li):not(.markdown-embed *)>p:last-child{
 margin-block-end:var(--paraflow-list-sibling-gap,var(--paraflow-p-margin-bottom,var(--paraflow-block-gap,.8em)));
}
${reading} .paraflow-code-display-frame > pre.paraflow-code-display{margin-inline:0}
${live} :where(a),${reading} :where(a){font-weight:inherit}
${live} :where(table),${reading} :where(table){font-weight:var(--paraflow-content-weight,400)}
${origin ? `/* Host cell-size variables resolve at body, before a content theme's table size. */
${live} :where(table) :where(td,th),${reading} :where(table) :where(td,th){font-size:inherit}
${live} .paraflow-rendered-block-html .paraflow-rendered-block-content p{
 margin-block-start:var(--paraflow-p-margin-top,var(--paraflow-block-gap,1em));
 margin-block-end:var(--paraflow-p-margin-bottom,var(--paraflow-block-gap,1em));
}` : ''}
${reading} li${exclude},${reading} :is(ul,ol):has(>li)${exclude},${live} .HyperMD-list-line:not(.paraflow-code-line)${exclude}{
 font-family:var(--paraflow-list-font,var(--font-text));font-size:var(--paraflow-list-size,var(--font-text-size));
 font-weight:var(--paraflow-list-weight,var(--paraflow-paragraph-weight,var(--paraflow-content-weight,400)));
 line-height:var(--paraflow-list-line-height,var(--paraflow-line-height));
}
${live} .cm-link .cm-underline${exclude},${live} .cm-url${exclude},${reading} a${exclude}{color:var(--link-color)}
${live} a.tag${exclude},${reading} a.tag${exclude}{color:var(--tag-color)}
${live} .cm-hashtag${exclude}{line-height:1}
${live} .paraflow-quote-line.HyperMD-task-line:is([data-task="x"],[data-task="X"])${exclude}{color:var(--checklist-done-color)}
${live} .paraflow-display-table a.tag${exclude},${reading} .paraflow-display-table a.tag${exclude}{color:var(--tag-color)}
${reading} :is(strong,b)${exclude},${live} :is(strong,b,.cm-strong)${exclude}{font-weight:var(--paraflow-strong-weight,var(--paraflow-default-strong-weight,var(--bold-weight,700)))}
${reading} .callout.paraflow-display-callout :is(strong,b):not(.markdown-embed *),${live} .callout.paraflow-display-callout :is(strong,b,.cm-strong):not(.markdown-embed *){font-weight:var(--paraflow-strong-weight,var(--paraflow-default-strong-weight,var(--bold-weight,700)))}
${live} .cm-cursor{border-left-color:var(--paraflow-content-color,var(--text-normal))}
${live} .metadata-container,${reading} .metadata-container{
 --metadata-label-font:var(--paraflow-metadata-font,var(--font-monospace));
 --metadata-input-font:var(--metadata-label-font);
 font-size:var(--paraflow-metadata-size,var(--paraflow-host-size));
 ${overrides.metadataLayout === 'native' ? '' : 'box-sizing:border-box;width:100%;max-width:var(--paraflow-text-width);margin-inline:auto;'}
 ${overrides.metadataPadding === undefined ? '' : `padding-inline:${overrides.metadataPadding}px;`}
 ${overrides.metadataGap === undefined ? '' : `margin-block-end:${overrides.metadataGap}px;`}
}
${semanticBlockRhythmCss(live)}
${readingBlockRhythmCss(reading)}
${live} :is(.metadata-property-key,.metadata-property-value,.metadata-property-key-input,.metadata-input-longtext),
${reading} :is(.metadata-property-key,.metadata-property-value,.metadata-property-key-input,.metadata-input-longtext){
 font-family:var(--metadata-label-font);font-size:inherit;
 font-weight:var(--paraflow-metadata-weight,400);
}
${live} .metadata-property-value :is(input,textarea,.multi-select-pill-content),
${reading} .metadata-property-value :is(input,textarea,.multi-select-pill-content){font:inherit}
${live} .HyperMD-codeblock:not(.paraflow-code-draft)${exclude}{
 background:var(--paraflow-block-code-background,var(--code-background));
 color:var(--paraflow-block-code-color,var(--code-normal));
 font-family:var(--paraflow-block-code-font,var(--font-monospace));
 font-size:var(--paraflow-block-code-size,.9em);
 line-height:var(--paraflow-block-code-line-height,var(--code-line-height,1.6));
 border-left:var(--paraflow-block-code-border,1px solid var(--paraflow-border-color,var(--background-modifier-border)));border-right:var(--paraflow-block-code-border,1px solid var(--paraflow-border-color,var(--background-modifier-border)));
 border-top:0;border-bottom:0;border-radius:0;
}
${live} .HyperMD-codeblock-begin:not(:is(.paraflow-code-line,.paraflow-code-draft))${exclude}{border-top:var(--paraflow-block-code-border,1px solid var(--paraflow-border-color,var(--background-modifier-border)));border-radius:var(--paraflow-block-code-radius,3px) var(--paraflow-block-code-radius,3px) 0 0}
${live} .HyperMD-codeblock-end:not(:is(.paraflow-code-line,.paraflow-code-draft))${exclude}{border-bottom:var(--paraflow-block-code-border,1px solid var(--paraflow-border-color,var(--background-modifier-border)));border-radius:0 0 var(--paraflow-block-code-radius,3px) var(--paraflow-block-code-radius,3px)}
${reading} pre${exclude}{
 background:var(--paraflow-block-code-background,var(--code-background));color:var(--paraflow-block-code-color,var(--code-normal));
 font-family:var(--paraflow-block-code-font,var(--font-monospace));font-size:var(--paraflow-block-code-size,.9em);
 line-height:var(--paraflow-block-code-line-height,var(--code-line-height,1.6));
}
${reading} pre code${exclude}{font:inherit;color:inherit;background:transparent;border:0;padding:0}
${reading} :not(pre)>code${exclude},${live} .cm-inline-code:not(:has(.paraflow-inline-body--inline-code)):not(:has(.paraflow-inline-source-active))${exclude}{
 color:var(--paraflow-inline-code-color,var(--code-normal));
 background:var(--paraflow-inline-code-background,var(--code-background));
 font-family:var(--paraflow-inline-code-font,var(--font-monospace));font-size:var(--paraflow-inline-code-size,.9em);
 border:var(--paraflow-inline-code-border,1px solid var(--paraflow-border-color,var(--background-modifier-border)));
 border-radius:var(--paraflow-inline-code-radius,3px);padding:var(--paraflow-inline-code-padding,0 .2em);
}
`;
}

/** Local overrides use content selectors (h1, .cm-header-1, etc.). */
export function scopeOverrides(source: string, id: string): string {
	validateThemeId(id);
	const roots = [`body[data-paraflow-theme="${id}"] .markdown-reading-view`,
		`body[data-paraflow-theme="${id}"] .markdown-source-view.mod-cm6.is-live-preview:not(.cm-table-widget *)`];
	const ast = css.parse(source, { parseCustomProperty: true, onParseError(error) { throw error; } });
	css.walk(ast, (node) => {
		if (node.type === 'Atrule' && !['media', 'supports'].includes(node.name.toLowerCase())) {
			throw new Error(`Unsupported override at-rule: @${node.name}`);
		}
		if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;
		const branches: string[] = [];
		for (const selector of node.prelude.children) {
			const text = css.generate(selector);
			if (/^(?:html|body|:root|#write)$/u.test(text)) branches.push(...roots);
			else {
				const children = selector.type === 'Selector' ? selector.children.toArray() : [];
				const pseudo = children.findIndex(child => child.type === 'PseudoElementSelector');
				const prefix = pseudo < 0 ? text : children.slice(0, pseudo).map(child => css.generate(child)).join('');
				const suffix = pseudo < 0 ? '' : children.slice(pseudo).map(child => css.generate(child)).join('');
				branches.push(...roots.map(root => `${root} ${prefix}:not(.callout):not(.callout *):not(.markdown-embed):not(.markdown-embed *)${suffix}`));
			}
		}
		node.prelude = css.parse(branches.join(','), { context: 'selectorList' }) as css.SelectorList;
	});
	return css.generate(ast);
}
