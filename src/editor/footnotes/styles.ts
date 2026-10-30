export const FOOTNOTE_CSS = `
.cm-tooltip.paraflow-footnote-tooltip-host {
  border: 0;
  background: transparent;
  box-shadow: none;
}
.paraflow-footnote-tooltip {
  max-width: min(28em, 85vw);
  padding: .3em .6em;
  border: 0;
  border-radius: .25em;
  background: #111;
  color: #fff;
  font-size: var(--font-small, .875em);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.paraflow-footnote-tooltip p { margin: 0; }
.paraflow-footnote-tooltip .paraflow-footnote-tooltip-hint { margin-top: .5em; font-size: .85em; opacity: .7; }
.cm-editor .cm-content[contenteditable] .cm-line .paraflow-footnote-source,
.cm-editor .cm-content[contenteditable] .cm-line .paraflow-footnote-source * { font-size: 0; }
.paraflow-footnote-reference,
.markdown-reading-view sup.paraflow-reading-footnote-reference {
  font-size: .72em;
  line-height: 0;
  vertical-align: baseline;
  position: relative;
  top: -.45em;
  color: var(--link-color);
  cursor: pointer;
}
.markdown-reading-view sup.paraflow-reading-footnote-reference > a {
  font-size: inherit;
  line-height: inherit;
}
.paraflow-footnote-definition {
  display: inline-block;
  font-size: inherit;
  font-weight: 600;
  line-height: inherit;
  vertical-align: baseline;
  color: var(--text-muted);
}
.cm-editor .cm-content .cm-line.paraflow-footnote-row .paraflow-footnote-definition-owner :is(.cm-footref, .cm-hmd-footnote),
.cm-editor .cm-content[contenteditable] .cm-line .paraflow-footnote-definition-source,
.cm-editor .cm-content[contenteditable] .cm-line .paraflow-footnote-definition-source * {
  font-weight: 600;
  color: var(--text-muted);
  font-size: inherit;
  line-height: inherit;
  vertical-align: baseline;
  position: static;
  top: auto;
}
.cm-editor .cm-content .cm-line .paraflow-footnote-reference-owner :is(.cm-footref, .cm-hmd-footnote),
.cm-editor .cm-content[contenteditable] .cm-line .paraflow-footnote-reference-source,
.cm-editor .cm-content[contenteditable] .cm-line .paraflow-footnote-reference-source * {
  font-size: inherit;
  line-height: inherit;
  vertical-align: baseline;
  position: static;
  top: auto;
}
.cm-line.paraflow-footnote-row { color: var(--text-muted); }
.cm-line.HyperMD-footnote.paraflow-footnote-row,
.markdown-reading-view .markdown-preview-view .footnotes.paraflow-reading-footnotes {
  font-size: var(--paraflow-footnote-size, var(--paraflow-default-footnote-size, var(--footnote-size, .875em)));
  line-height: var(--paraflow-footnote-line-height, var(--paraflow-line-height, var(--line-height-normal, 1.6)));
}
.markdown-reading-view .markdown-preview-view .footnotes.paraflow-reading-footnotes :is(ol,ul,li,p) {
  font-size: inherit;
  line-height: inherit;
}
.cm-editor .cm-content[contenteditable] .cm-line .paraflow-footnote-marker,
.cm-editor .cm-content[contenteditable] .cm-line .paraflow-footnote-marker * { color: var(--paraflow-source-color, var(--text-faint)); }
.paraflow-footnote-marker-hidden { visibility: hidden; }
.paraflow-footnote-reference[data-footnote-status="missing"],
.paraflow-footnote-reference[data-footnote-status="duplicate"],
.paraflow-footnote-definition[data-footnote-status="duplicate"] {
  text-decoration: underline dotted;
  text-decoration-color: var(--text-warning);
}
.paraflow-footnote-backlinks { margin-inline-start: .4em; }
.paraflow-footnote-backlinks .paraflow-footnote-backlink {
  font-family: var(--font-monospace), monospace;
  font-size: .75em; padding: 0 .2em; height: auto; border: 0;
  background: transparent; box-shadow: none; color: var(--link-color);
  cursor: pointer;
}
.paraflow-footnote-reference:focus-visible,
.paraflow-footnote-backlink:focus-visible { outline: 1px solid var(--interactive-accent); }
.paraflow-footnote-target { background: var(--text-highlight-bg); }
.footnotes > ol > li.paraflow-reading-footnote { list-style-type: none; color: var(--text-muted); }
.paraflow-reading-footnote-label { font-weight: 600; margin-inline-end: .6em; }
`;
