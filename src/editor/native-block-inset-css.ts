/** Widget interiors own margins; native rows and tables retain their host margins and offset their content box. */
export const NATIVE_BLOCK_INSET_CSS = `
.markdown-source-view.mod-cm6 .cm-editor .paraflow-block-widget-shell :is(.paraflow-code-heading,.paraflow-code-ending-space,.paraflow-code-scroll),
.markdown-source-view.mod-cm6 .cm-editor .paraflow-block-widget-shell > .paraflow-code-ending,
.markdown-source-view.mod-cm6 .cm-editor .paraflow-block-widget-shell > .paraflow-container-block > .paraflow-code-ending { margin-inline: var(--paraflow-native-block-inset, 0px) 0; }
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .cm-line.paraflow-code-fenced-list:not(.paraflow-callout-line),
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .cm-line.paraflow-code-indented:not(.paraflow-callout-line),
.markdown-source-view.mod-cm6:where(.is-live-preview) :where(.paraflow-table-display-active) .cm-table-widget,
.markdown-source-view.mod-cm6.is-live-preview .cm-table-widget.paraflow-display-table-widget,
body[data-paraflow-theme="builtin-classic"] .markdown-source-view.mod-cm6.is-live-preview .cm-table-widget {
  position: relative;
  inset-inline-start: calc(var(--paraflow-native-block-inset, 0px) + var(--paraflow-host-block-margin-compensation, 0px));
  inline-size: calc(100% - var(--paraflow-native-block-inset, 0px));
}
.markdown-source-view.mod-cm6 .cm-table-widget { --paraflow-host-block-margin-compensation: var(--size-4-4); }
.markdown-source-view.mod-cm6 .cm-table-widget.is-loading { --paraflow-host-block-margin-compensation: 0px; }
`;
