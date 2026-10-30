const source = '.markdown-source-view.mod-cm6:not(.is-live-preview) > .cm-editor.paraflow-source-view';
export const sourceContentSelector = `:is(${source} > .cm-scroller > .cm-content,${source} > .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content)`;
const list = '.markdown-source-view.mod-cm6.is-live-preview > .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)';
const nativeOrigin = `${list} :where(.paraflow-structured-list-active *, .paraflow-callout-line):is(.HyperMD-list-line-1, .HyperMD-list-line-2, .HyperMD-list-line-3, .HyperMD-list-line-4, .HyperMD-list-line-5, .HyperMD-list-line-6, .paraflow-list-marker-line):not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line)`;
const ownedOrigin = `${list} :is(.paraflow-list-owned-line-1, .paraflow-list-owned-line-2, .paraflow-list-owned-line-3, .paraflow-list-owned-line-4, .paraflow-list-owned-line-5, .paraflow-list-owned-line-6):not(.paraflow-math-source-block),.cm-editor.paraflow-math-active .cm-line.paraflow-math-source-block`;

/** Source rows own paragraph indents, list hanging indents and prefix text origins. */
export const SOURCE_TEXT_ORIGIN_CSS = `
.markdown-source-view.mod-cm6.is-live-preview > .cm-editor .cm-content[contenteditable] > .cm-line.paraflow-body-paragraph.paraflow-body-indent { text-indent: 2em; }
${nativeOrigin} { --paraflow-source-text-origin: calc(0px - var(--paraflow-live-list-content-offset) - var(--paraflow-live-list-hanging-indent)); }
${ownedOrigin} { --paraflow-source-text-origin: 0; }
/* These rows replace the native editor's inline indentation as one layout owner. */
${nativeOrigin},${ownedOrigin} { text-indent: var(--paraflow-source-text-origin) !important; }
${sourceContentSelector} > .cm-line,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .cm-line.paraflow-rendered-source-line,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .cm-line.paraflow-code-draft:not(.paraflow-callout-line):not(.HyperMD-list-line):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6 .cm-editor .cm-line.paraflow-code-line,
.markdown-source-view.mod-cm6 .cm-editor .cm-line.paraflow-code-line:is(.paraflow-code-wrap,.paraflow-code-virtual)[data-paraflow-line],
.paraflow-code-row[data-paraflow-line],
.paraflow-code-line[data-paraflow-line]::before,
.markdown-source-view.mod-cm6.is-live-preview .cm-line.paraflow-code-line[data-paraflow-line]::before,
.paraflow-code-row[data-paraflow-line]::before,
${list} .paraflow-list-empty-body,
${list} > .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content[contenteditable] .paraflow-list-separator,
${list} .paraflow-task-prefix { text-indent: 0; }
`;
