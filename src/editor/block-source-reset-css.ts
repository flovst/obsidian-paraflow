import { SOURCE_TEXT_ORIGIN_CSS } from './source-text-origin-css.js';
import { WIDGET_OVERFLOW_CSS } from './widget-overflow-css.js';
import { NATIVE_BLOCK_INSET_CSS } from './native-block-inset-css.js';
/** Native syntax tokens inside owned source rows share one reset surface. */
export const BLOCK_SOURCE_RESET_CSS = SOURCE_TEXT_ORIGIN_CSS + WIDGET_OVERFLOW_CSS + NATIVE_BLOCK_INSET_CSS + `
.markdown-source-view.mod-cm6 .cm-editor .cm-line.paraflow-code-line .cm-inline-code,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-rendered-source-line .cm-inline-code,
.markdown-source-view.mod-cm6 .cm-editor .paraflow-rendered-block-badge,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .cm-line.paraflow-rendered-source-line::before { border: 0; border-radius: 0; }
.markdown-source-view.mod-cm6 .cm-editor .cm-line.paraflow-code-line .cm-inline-code,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-rendered-source-line .cm-inline-code { background: transparent; padding: 0; font: inherit; }
.markdown-source-view.mod-cm6 .cm-editor .cm-line.paraflow-code-line .cm-inline-code,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-rendered-source-line .cm-inline-code { color: inherit; }
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-rendered-source-line .cm-inline-code,
.markdown-source-view.mod-cm6 .cm-editor .paraflow-rendered-block-badge { box-shadow: none; }
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-rendered-source-line .cm-inline-code,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .cm-line.paraflow-rendered-source-line { margin: 0; }
`;
