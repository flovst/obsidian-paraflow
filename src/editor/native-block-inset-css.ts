/** Native block margins are reset by the host; each owned surface supplies its start inset. */
export const NATIVE_BLOCK_INSET_CSS = `
.markdown-source-view.mod-cm6.is-live-preview .cm-content > :is(.paraflow-code-heading,.paraflow-code-ending-space,.paraflow-code-ending,.paraflow-code-scroll),
.markdown-source-view.mod-cm6 .cm-editor .cm-content > :is(.paraflow-code-heading,.paraflow-code-ending-space,.paraflow-code-ending,.paraflow-code-scroll),
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-container-block > :is(.paraflow-code-heading,.paraflow-code-ending-space,.paraflow-code-ending,.paraflow-code-scroll),
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .cm-line.paraflow-code-fenced-list:not(.paraflow-callout-line),
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .cm-line.paraflow-code-indented:not(.paraflow-callout-line),
.markdown-source-view.mod-cm6:where(.is-live-preview) :where(.paraflow-table-display-active) .cm-table-widget,
.markdown-source-view.mod-cm6.is-live-preview .cm-table-widget.paraflow-display-table-widget,
body[data-paraflow-theme="builtin-classic"] .markdown-source-view.mod-cm6.is-live-preview .cm-table-widget { margin-inline: var(--paraflow-native-block-inset, 0px) 0 !important; }
`;
