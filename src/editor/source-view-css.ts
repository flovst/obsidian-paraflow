import { SOURCE_TEXT_ORIGIN_CSS, sourceContentSelector } from './source-text-origin-css.js';
const scope = '.markdown-source-view.mod-cm6:not(.is-live-preview) > .cm-editor.paraflow-source-view';
const content = sourceContentSelector;
const gutters = (suffix: string): string => `:is(${scope}${suffix} > .cm-scroller > .cm-gutters,${scope}${suffix} > .cm-scroller > .cm-sizer > .cm-gutters,${scope}${suffix} > .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-gutters)`;
// The fixed-size head and stop are right-aligned; short tab stops clip only the shaft.
const tabSymbol = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='12' viewBox='0 0 48 12'%3E%3Cpath d='M0 5.5H45.5M42 3.5L44 5.5L42 7.5M45.5 3V8' fill='none' stroke='black' stroke-width='1'/%3E%3C/svg%3E";
export const SOURCE_VIEW_LAYOUT_CSS = `
.markdown-source-view.mod-cm6:not(.is-live-preview) > .cm-editor.paraflow-source-scroll-limit > .cm-scroller,
.markdown-source-view.mod-cm6:not(.is-live-preview) > .cm-editor.paraflow-source-scroll-limit > .cm-scroller :is(.cm-sizer,.cm-contentContainer) { padding-bottom:0; }
.markdown-source-view.mod-cm6:not(.is-live-preview) > .cm-editor.paraflow-source-scroll-limit > .cm-scroller .cm-content { padding-bottom:var(--file-margins,32px); }
${scope} > .cm-scroller { font-family:var(--paraflow-source-font,var(--paraflow-font-family,var(--font-text))); font-size:var(--font-text-size,16px); line-height:var(--paraflow-line-height,1.6); }
${content} > .cm-line {
 min-height:0;height:auto;margin-block:0;padding-block:0;
 padding-inline-start:0;
}
${content} > .cm-line:is(.HyperMD-header-1,.HyperMD-header-2),
${content} > .cm-line .cm-header-1,${content} > .cm-line .cm-header-2 { font-family:inherit; }
${content} > .cm-line.HyperMD-header-1 { font-size:calc(var(--font-text-size,16px) * 2); }
${content} > .cm-line.HyperMD-header-2 { font-size:calc(var(--font-text-size,16px) * 1.5); }
${content} > .cm-line .cm-header-1,${content} > .cm-line .cm-header-2 { font-size:inherit; }
${content} > .cm-line :is(.cm-hmd-list-indent,.cm-indent,.cm-indent-spacing) { display:inline;width:auto;min-width:0; }
${content.replaceAll('.paraflow-source-view', '.paraflow-source-view.paraflow-source-indent-guides-off')} > .cm-line .cm-indent::before { display:none; }
${content} > .cm-line.paraflow-source-quote { color:var(--text-muted); }
${content} > .cm-line.paraflow-source-quote .cm-quote { color:var(--text-muted); }
${content} > .cm-line .cm-formatting { color:var(--paraflow-source-accent,var(--interactive-accent)); }
${content} > .cm-activeLine { background:#f5f5f5; }
.theme-dark ${content} > .cm-activeLine { background:var(--background-secondary); }
${gutters('')} > .cm-gutter > .cm-activeLineGutter { background:#f5f5f5; }
.theme-dark ${gutters('')} > .cm-gutter > .cm-activeLineGutter { background:var(--background-secondary); }
${gutters('.paraflow-source-gutter-body-left')} { transform:translateX(var(--paraflow-source-gutter-shift,0px)); }
/* The native gutter clips child paint at the line-number edge. */
${gutters('.paraflow-source-gutter-body-left')} > .cm-gutter:last-child { overflow:visible; }
${gutters('.paraflow-source-gutter-body-left')} > .cm-gutter:last-child > .cm-activeLineGutter { position:relative; }
${gutters('.paraflow-source-gutter-body-left')} > .cm-gutter:last-child > .cm-activeLineGutter::after { content:'';position:absolute;left:100%;top:0;bottom:0;width:var(--paraflow-source-gutter-gap,0px);background:inherit;pointer-events:none; }
${scope} :is(.cm-highlightSpace,.cm-highlightTab),
${content.replaceAll('.paraflow-source-view', '.paraflow-source-view.paraflow-source-whitespace-off')} > .cm-line > :is(.cm-highlightSpace,.cm-highlightTab) { background-image:none; }
${scope} .cm-highlightSpace { position:relative; }
${scope} .cm-highlightSpace::before { content:'•';position:absolute;left:-.1em;font-family:LetterGothicStd,monospace;font-weight:400;font-style:normal;color:inherit;opacity:.2;pointer-events:none; }
${content} > .cm-line :is(.paraflow-source-space,.paraflow-source-tab,.paraflow-source-nbsp-metric) { font-family:var(--font-monospace,monospace); }
${scope} .paraflow-source-tab { display:inline-block;width:calc(var(--paraflow-source-tab-columns) * 1ch);tab-size:var(--paraflow-source-tab-columns); }
${scope} .cm-highlightTab { position:relative; }
${scope} .cm-highlightTab::before { content:'';position:absolute;inset:0;background-color:currentColor;opacity:.28;mask-image:url("${tabSymbol}");mask-position:calc(100% - .1em) center;mask-repeat:no-repeat;pointer-events:none; }
${scope} .paraflow-source-nbsp { position:relative; }
${scope} .paraflow-source-nbsp::before { content:'⍽';position:absolute;inset-inline:0;color:var(--text-faint);pointer-events:none; }
${scope} .paraflow-source-zwsp { color:var(--paraflow-source-accent,var(--interactive-accent)); }
${gutters('.paraflow-source-line-numbers-off')} > .cm-lineNumbers { display:none; }
${content.replaceAll('.paraflow-source-view', '.paraflow-source-view.paraflow-source-active-line-off')} > .cm-activeLine { background:transparent; }
${gutters('.paraflow-source-active-line-off')} > .cm-gutter > .cm-activeLineGutter { background:transparent; }
${scope} .paraflow-source-newline:not(.paraflow-source-hard-break) { color:var(--text-faint);font-size:inherit;pointer-events:none;user-select:none; }
${scope} .paraflow-source-hard-break { position:relative; }
${scope} .paraflow-source-hard-break::before { content:'↓';position:absolute;left:0;font-family:LetterGothicStd,monospace;font-weight:400;font-style:normal;color:inherit;opacity:.3;pointer-events:none; }
`;

/** Complete source surface for isolated editor consumers. */
export const SOURCE_VIEW_CSS = SOURCE_TEXT_ORIGIN_CSS + SOURCE_VIEW_LAYOUT_CSS;
