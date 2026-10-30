/** A non-atomic shell preserves widget bounds while allowing controls and content to overflow. */
export const WIDGET_OVERFLOW_CSS = `
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-block-widget-shell { display: inline; }
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-block-widget-shell[hidden] { display: none; }
.markdown-source-view.mod-cm6 .cm-editor .paraflow-block-widget-shell > :is(.paraflow-rendered-block-preview,.paraflow-math-block-preview) { margin: 0; }
`;
