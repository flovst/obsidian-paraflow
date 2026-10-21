export const mathEditorStyles = `
.cm-editor.paraflow-math-active .paraflow-math-pending,
.cm-editor.paraflow-math-active .paraflow-math-pending .cm-math,
.cm-editor.paraflow-math-active .paraflow-math-draft,
.cm-editor.paraflow-math-active .paraflow-math-draft * {
  color: var(--text-normal) !important;
  background: transparent !important;
  text-decoration: none !important;
  box-shadow: none !important;
  font-family: var(--font-text) !important;
  font-size: var(--font-text-size, 16px) !important;
  font-weight: 400 !important;
  font-style: normal !important;
}
/* Native end widgets survive higher-precedence replacements at their boundary. */
.cm-editor.paraflow-math-active > .cm-scroller > .cm-content > :is(.math-block, .cm-math-block):not(.paraflow-math-rendered),
.cm-editor.paraflow-math-active > .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content > :is(.math-block, .cm-math-block):not(.paraflow-math-rendered) {
  display: none !important;
}
.cm-editor.paraflow-math-active .paraflow-math-source,
.cm-editor.paraflow-math-active .paraflow-math-source * {
  font-family: var(--font-monospace);
  font-size: inherit;
  font-style: normal;
  font-weight: normal;
  color: var(--paraflow-math-body-color, var(--text-normal));
}
.cm-editor.paraflow-math-active .paraflow-math-command,
.cm-editor.paraflow-math-active .paraflow-math-command * { color: var(--paraflow-math-command-color); }
.cm-editor.paraflow-math-active .paraflow-math-punctuation,
.cm-editor.paraflow-math-active .paraflow-math-punctuation * { color: var(--paraflow-math-punctuation-color); }
.cm-editor.paraflow-math-active .paraflow-math-number,
.cm-editor.paraflow-math-active .paraflow-math-number * { color: var(--paraflow-math-number-color); }
.cm-editor.paraflow-math-active .paraflow-math-delimiter,
.cm-editor.paraflow-math-active .paraflow-math-boundary { color: var(--paraflow-source-color, var(--text-faint)); }
.cm-editor.paraflow-math-active .cm-line.paraflow-math-source-block {
  position: relative;
  box-sizing: border-box;
  display: block !important;
  height: auto !important;
  min-height: calc(1em * var(--line-height-normal, 1.5)) !important;
  line-height: var(--line-height-normal, 1.5) !important;
  white-space: pre-wrap !important;
  text-indent: 0 !important;
  padding: 0 .5em 0 4.5ch !important;
  margin: 0 !important;
  border-inline: 1px solid var(--paraflow-border-color);
  background: var(--paraflow-surface-color);
  font-family: var(--font-monospace);
}
/* Container rails have their own spans; native quote pseudo-borders must not paint the gutter. */
.cm-editor.paraflow-math-active .cm-line.paraflow-math-source-block::before { border-inline-start: 0 !important; }
.cm-editor.paraflow-math-active .paraflow-math-source-block[data-paraflow-math-line]::before {
  content: attr(data-paraflow-math-line) !important;
  display: block !important;
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  box-sizing: border-box;
  width: 3.5ch;
  padding-inline-end: .7ch;
  border-inline-end: 1px solid var(--paraflow-border-color);
  color: var(--text-faint) !important;
  text-align: end;
  pointer-events: none;
  user-select: none;
}
/* Leading whitespace remains editable; only its native indent guide is decorative. */
.cm-editor.paraflow-math-active .paraflow-math-source-block .cm-indent::before { display: none; }
.cm-editor.paraflow-math-active .cm-line.paraflow-math-source-start {
  border-block-start: 1px solid var(--paraflow-border-color);
  border-radius: 3px 3px 0 0;
  padding-block-start: .4em !important;
  contain: none !important;
  overflow: visible !important;
}
.cm-editor.paraflow-math-active .paraflow-math-source-block:not([data-paraflow-math-line]) {
  min-height: 1em !important;
  line-height: 1 !important;
}
.cm-editor.paraflow-math-active .paraflow-math-boundary {
  font-size: inherit;
  user-select: none;
  pointer-events: none;
}
.cm-editor.paraflow-math-active .paraflow-math-source-block .paraflow-math-boundary {
  position: absolute;
  inset-inline-start: var(--paraflow-container-inset, 0px);
  width: 3.5ch;
  padding-inline-end: .7ch;
  box-sizing: border-box;
  text-align: end;
  line-height: 1;
}
.cm-editor.paraflow-math-active .paraflow-math-boundary-open { inset-block-start: .4em; }
.cm-editor.paraflow-math-active .paraflow-math-boundary-close { inset-block-end: .4em; }
.cm-editor.paraflow-math-active .cm-line.paraflow-math-source-end { padding-block-end: .4em !important; }
.cm-editor.paraflow-math-active .cm-line.paraflow-callout-line.paraflow-math-source-start {
  border-block-start: 0;
}
.cm-editor.paraflow-math-active .cm-line.paraflow-callout-line.paraflow-math-source-block::after {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline: var(--paraflow-container-inset) var(--paraflow-container-end-inset);
  box-sizing: border-box;
  border-inline: 1px solid var(--paraflow-border-color);
  pointer-events: none;
  z-index: 2;
}
.cm-editor.paraflow-math-active .cm-line.paraflow-callout-line.paraflow-math-source-start::after {
  border-block-start: 1px solid var(--paraflow-border-color);
  border-radius: 3px 3px 0 0;
}
.cm-editor.paraflow-math-active .cm-line.paraflow-math-source-start-inline { padding-block-start: 1.4em !important; }
.cm-editor.paraflow-math-active .cm-line.paraflow-math-source-end-inline { padding-block-end: 1.4em !important; }
.cm-editor.paraflow-math-active .paraflow-math-source-start-inline::before { inset-block-start: 1.4em; }
.cm-editor.paraflow-math-active .paraflow-math-source-end-inline::before { inset-block-end: 1.4em; }
.paraflow-math-rendered, .paraflow-math-tooltip { font-weight: normal; font-style: normal; }
.paraflow-math-block-preview {
  position: relative;
  display: block;
  box-sizing: border-box;
  text-align: center;
  margin-block: 0;
  margin-block-start: 1.25em;
  padding: .4em .5em;
  overflow: visible;
}
/* The host paint-containment rule would clip the label above this widget. */
.cm-editor .paraflow-math-block-preview,
.markdown-source-view.mod-cm6 .cm-editor .cm-content .paraflow-math-block-preview {
  contain: none !important;
}
.paraflow-math-rendered.paraflow-math-block-preview > mjx-container[jax][display="true"],
.paraflow-math-rendered.paraflow-math-block-preview > mjx-container[display="true"]:not([jax]) {
  margin: 0;
  margin-block: 0;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}
.cm-editor.paraflow-math-active .paraflow-math-source-end + .paraflow-container-block > .paraflow-math-block-preview,
.cm-editor.paraflow-math-active .paraflow-math-source-end + .paraflow-math-block-preview {
  margin-block-start: 0;
  border: 1px solid var(--paraflow-border-color);
  border-block-end-color: var(--paraflow-math-preview-divider, var(--text-faint));
  border-radius: 0 0 3px 3px;
  background: var(--background-primary);
}
.cm-editor.paraflow-math-active .paraflow-math-source-inline {
  background: color-mix(in srgb, var(--paraflow-math-command-color) 8%, transparent);
  color: color-mix(in srgb, var(--paraflow-math-command-color) 60%, var(--paraflow-math-body-color));
  border-radius: .15em;
}
.cm-editor.paraflow-math-active .paraflow-math-source-inline * {
  color: inherit;
}
.cm-editor.paraflow-math-active .paraflow-math-source-inline .paraflow-math-command { color: var(--paraflow-math-command-color); }
.cm-editor.paraflow-math-active .paraflow-math-source-inline .paraflow-math-number { color: var(--paraflow-math-number-color); }
.cm-editor.paraflow-math-active .paraflow-math-source-inline .paraflow-math-punctuation { color: var(--paraflow-math-punctuation-color); }
.cm-editor.paraflow-math-active .paraflow-math-source-inline .paraflow-math-delimiter { color: var(--paraflow-source-color, var(--text-faint)); }
.cm-editor.paraflow-math-active .paraflow-math-source-start .paraflow-math-badge,
.paraflow-math-block-preview::before {
  position: absolute;
  inset-inline-end: .5em;
  inset-block-end: calc(100% + 1px);
  font: .75em/1.25 var(--font-interface, var(--font-monospace));
  color: var(--text-faint);
  pointer-events: none;
  user-select: none;
}
.cm-editor.paraflow-math-active .paraflow-callout-line.paraflow-math-source-start .paraflow-math-badge {
  inset-inline-end: calc(var(--paraflow-container-end-inset) + .5em);
}
.paraflow-math-block-preview::before {
  content: '公式';
  opacity: 0;
  transition: opacity 120ms;
}
.paraflow-math-block-preview:hover {
  background: var(--paraflow-surface-color);
}
.paraflow-math-block-preview:hover::before { opacity: 1; }
.paraflow-math-source-end + .paraflow-container-block > .paraflow-math-block-preview::before,
.paraflow-math-source-end + .paraflow-math-block-preview::before { content: none; }
.cm-editor.paraflow-math-active .cm-tooltip.paraflow-math-tooltip {
  background: #111;
  color: #fff;
  border: 0;
  border-radius: .25em;
  padding: .25em .6em;
  max-width: min(40em, calc(100vw - 1.5em));
  box-shadow: none;
  overflow: visible;
}
.cm-editor .paraflow-math-tooltip > mjx-container { display: block; max-width: 100%; overflow-x: auto; overflow-y: hidden; color: inherit; }
.cm-editor .paraflow-math-tooltip .cm-tooltip-arrow::before { border-bottom-color: #111; border-top-color: #111; }
.cm-editor .paraflow-math-tooltip .cm-tooltip-arrow::after { border: 0; }
`;
