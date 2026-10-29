/** Native syntax tokens inside owned source rows share one reset surface. */
export const BLOCK_SOURCE_RESET_CSS = `
.markdown-source-view.mod-cm6 .cm-editor .cm-line.paraflow-code-line .cm-inline-code,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-rendered-source-line .cm-inline-code,
.markdown-source-view.mod-cm6 .cm-editor .paraflow-rendered-block-badge,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .cm-line.paraflow-rendered-source-line::before { border: 0 !important; border-radius: 0 !important; }
.markdown-source-view.mod-cm6 .cm-editor .cm-line.paraflow-code-line .cm-inline-code,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-rendered-source-line .cm-inline-code { background: transparent !important; padding: 0 !important; font: inherit !important; }
.markdown-source-view.mod-cm6 .cm-editor .cm-line.paraflow-code-line .cm-inline-code { color: inherit !important; }
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-rendered-source-line .cm-inline-code,
.markdown-source-view.mod-cm6 .cm-editor .paraflow-rendered-block-badge { box-shadow: none !important; }
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-rendered-source-line .cm-inline-code,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .cm-line.paraflow-rendered-source-line { margin: 0 !important; }
`;
