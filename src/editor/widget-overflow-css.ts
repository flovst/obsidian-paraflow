/** Source controls extend beyond the native block widget's paint box. */
export const WIDGET_OVERFLOW_CSS = `
.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-callout-active .cm-content > .paraflow-container-boundary-gap,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-code-heading,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-container-block > .paraflow-code-heading,
.markdown-source-view.mod-cm6 .cm-editor .paraflow-rendered-block-preview,
.markdown-source-view.mod-cm6 .cm-editor .cm-content .paraflow-rendered-block-preview,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .cm-line.paraflow-rendered-source-line,
.cm-editor.paraflow-math-active .cm-line.paraflow-math-source-start,
.cm-editor .paraflow-math-block-preview,
.markdown-source-view.mod-cm6 .cm-editor .cm-content .paraflow-math-block-preview { contain: none !important; }
`;
