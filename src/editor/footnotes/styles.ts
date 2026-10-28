export const FOOTNOTE_CSS = `
.cm-tooltip:has(> .paraflow-footnote-tooltip) {
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
.paraflow-footnote-source,
.paraflow-footnote-source * { font-size: 0 !important; }
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
.cm-line.paraflow-footnote-row .cm-footref:has(.paraflow-footnote-definition-source),
.cm-line.paraflow-footnote-row .cm-footref:has(.paraflow-footnote-definition),
.cm-line.paraflow-footnote-row .cm-hmd-footnote:has(.paraflow-footnote-definition-source),
.cm-line.paraflow-footnote-row .cm-hmd-footnote:has(.paraflow-footnote-definition),
.paraflow-footnote-definition-source,
.paraflow-footnote-definition-source * {
  font-size: inherit !important;
  font-weight: 600 !important;
  line-height: inherit !important;
  vertical-align: baseline !important;
  position: static !important;
  top: auto !important;
  color: var(--text-muted) !important;
}
.cm-line .cm-footref:has(.paraflow-footnote-reference-source),
.cm-line .cm-hmd-footnote:has(.paraflow-footnote-reference-source),
.cm-line .cm-footref:has(.paraflow-footnote-reference),
.cm-line .cm-hmd-footnote:has(.paraflow-footnote-reference),
.paraflow-footnote-reference-source,
.paraflow-footnote-reference-source * {
  font-size: inherit !important;
  line-height: inherit !important;
  vertical-align: baseline !important;
  position: static !important;
  top: auto !important;
}
.cm-line.paraflow-footnote-row { color: var(--text-muted); }
.cm-line.HyperMD-footnote.paraflow-footnote-row,
.markdown-reading-view .markdown-preview-view .footnotes:has(> ol > li.paraflow-reading-footnote) {
  font-size: var(--paraflow-footnote-size, var(--paraflow-default-footnote-size, var(--footnote-size, .875em)));
  line-height: var(--paraflow-footnote-line-height, var(--paraflow-line-height, var(--line-height-normal, 1.6)));
}
.markdown-reading-view .markdown-preview-view .footnotes:has(> ol > li.paraflow-reading-footnote) :is(ol,ul,li,p) {
  font-size: inherit;
  line-height: inherit !important;
}
.paraflow-footnote-marker, .paraflow-footnote-marker * { color: var(--paraflow-source-color, var(--text-faint)) !important; }
.paraflow-footnote-marker-hidden { visibility: hidden; }
.paraflow-footnote-reference[data-footnote-status="missing"],
.paraflow-footnote-reference[data-footnote-status="duplicate"],
.paraflow-footnote-definition[data-footnote-status="duplicate"] {
  text-decoration: underline dotted;
  text-decoration-color: var(--text-warning);
}
.paraflow-footnote-backlinks { margin-inline-start: .4em; }
.paraflow-footnote-backlinks .paraflow-footnote-backlink {
  font-family: ui-monospace, sans-serif;
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
