export const renderedBlockEditorStyles = `
.paraflow-rendered-block-preview {
  position: relative;
  box-sizing: border-box;
  margin-block: 1.25em .8em;
  padding: .4em .5em;
  background: transparent;
  transition: background-color .15s ease;
  overflow: visible;
}
.paraflow-rendered-block-preview:hover { background: var(--paraflow-surface-color, var(--background-secondary)); }
/* Keep the external source button visible and hit-testable under native CSS. */
.cm-editor .paraflow-rendered-block-preview,
.markdown-source-view.mod-cm6 .cm-editor .cm-content .paraflow-rendered-block-preview {
  contain: none !important;
}
.paraflow-rendered-block-preview.is-editing {
  margin-block: 0 .8em;
  border: 1px solid var(--paraflow-border-color, var(--background-modifier-border));
  border-block-end-color: var(--background-modifier-border-hover, var(--text-faint));
}
.paraflow-rendered-block-mermaid { padding: 0; }
.paraflow-rendered-block-mermaid .paraflow-rendered-block-content { text-align: center; overflow-x: auto; }
.markdown-reading-view .mermaid.paraflow-reading-mermaid { text-align: center; overflow-x: auto; }
.paraflow-rendered-block-mermaid .mermaid > svg,
.markdown-reading-view .mermaid.paraflow-reading-mermaid > svg { display: block; margin-inline: auto; }
.paraflow-rendered-block-mermaid .mermaid,
.markdown-reading-view .mermaid.paraflow-reading-mermaid { font-weight: normal; }
/* Keep native insertion/measurement live while a valid prior diagram is shown. */
.paraflow-rendered-block-mermaid .paraflow-rendered-block-content.is-pending {
  position: absolute;
  inset-block-start: 0;
  inset-inline: .5em;
  opacity: 0;
  pointer-events: none;
}
.paraflow-rendered-block-html .paraflow-rendered-block-content { white-space: normal; }
.paraflow-rendered-block-preview.paraflow-rendered-block-html { padding: 0; }
.paraflow-rendered-block-content > :first-child { margin-block-start: 0; }
.paraflow-rendered-block-content > :last-child { margin-block-end: 0; }
.paraflow-rendered-block-preview[data-render-state="error"] .paraflow-rendered-block-content { color: var(--text-error); }
.paraflow-rendered-block-badge {
  position: absolute !important;
  inset-block-end: 100%;
  inset-inline-end: 0;
  height: auto !important;
  min-height: 0 !important;
  padding: .1em .55em !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  font: .75em/1.4 var(--font-interface) !important;
  color: var(--text-muted) !important;
  background: var(--paraflow-surface-color, var(--background-secondary)) !important;
  opacity: 0;
  user-select: none;
  transition: opacity .15s ease;
}
.paraflow-rendered-block-preview:hover > .paraflow-rendered-block-badge,
.paraflow-rendered-block-badge:focus-visible,
.paraflow-rendered-source-line .paraflow-rendered-block-badge { opacity: 1; }
.cm-editor .cm-content > .cm-line.paraflow-rendered-source-line {
  position: relative;
  display: block !important;
  box-sizing: border-box;
  height: auto !important;
  min-height: 1lh !important;
  line-height: var(--code-line-height, 1.6) !important;
  text-indent: 0 !important;
  white-space: pre-wrap !important;
  margin: 0 !important;
  padding: 0 .5em 0 4.5ch !important;
  font-family: var(--paraflow-block-code-font, var(--font-monospace));
  font-size: var(--paraflow-block-code-size, .9em);
  background: var(--paraflow-surface-color, var(--background-secondary)) !important;
  border-inline: 1px solid var(--paraflow-border-color, var(--background-modifier-border));
  overflow: visible !important;
  contain: none !important;
}
.cm-editor .cm-content > .cm-line.paraflow-rendered-source-line.is-first { margin-block-start: 1.25em !important; padding-block-start: .3em !important; }
.cm-editor .cm-content > .cm-line.paraflow-rendered-source-line.is-last { padding-block-end: .3em !important; }
.cm-editor .cm-content > .cm-line.paraflow-rendered-source-line::before {
  content: attr(data-paraflow-rendered-line) !important;
  display: block !important;
  position: absolute;
  inset-inline-start: 0;
  inset-block: 0;
  width: 3.5ch;
  box-sizing: border-box;
  padding-inline-end: .7ch;
  text-align: end;
  border: 0 !important;
  border-radius: 0 !important;
  border-inline-end: 1px solid var(--paraflow-border-color, var(--background-modifier-border)) !important;
  color: var(--text-faint) !important;
  pointer-events: none;
  user-select: none;
}
.cm-editor .cm-content > .cm-line.paraflow-rendered-source-line.is-first::before { padding-block-start: .3em; }
.cm-editor .cm-content > .paraflow-rendered-source-line .cm-inline-code {
  padding: 0 !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: none !important;
  box-shadow: none !important;
  font: inherit !important;
}
.paraflow-rendered-source-line .cm-indent { display: none; }
.paraflow-rendered-block-fence { height: 0; min-height: 0; padding: 0; margin: 0; }
.paraflow-rendered-block-fence.paraflow-rendered-block-empty { height: auto; padding: .5em; }
.paraflow-rendered-source-text,
.paraflow-rendered-source-text * { font-family: inherit; font-weight: normal; font-style: normal; color: var(--text-normal); }
.paraflow-html-tag, .paraflow-html-tag * { color: var(--paraflow-html-tag-color, #4078f2); }
.paraflow-html-attribute, .paraflow-html-attribute * { color: var(--paraflow-html-attribute-color, #a626a4); }
.paraflow-html-string, .paraflow-html-string * { color: var(--paraflow-html-string-color, #50a14f); }
.paraflow-html-punctuation, .paraflow-html-punctuation *, .paraflow-html-comment, .paraflow-html-comment * { color: var(--paraflow-source-color, var(--text-faint)); }
.theme-dark .paraflow-rendered-source-html {
  --paraflow-html-tag-color: #61afef;
  --paraflow-html-attribute-color: #c678dd;
  --paraflow-html-string-color: #98c379;
}
@media (prefers-reduced-motion: reduce) {
  .paraflow-rendered-block-preview, .paraflow-rendered-block-badge { transition: none; }
}
`;
