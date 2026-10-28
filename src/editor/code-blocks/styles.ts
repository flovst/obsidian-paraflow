import { LIST_BLOCK_GEOMETRY_CSS } from '../paragraph/list-block-geometry.js';

export const CODE_BLOCK_CSS = LIST_BLOCK_GEOMETRY_CSS + `
.paraflow-code-plain { color:var(--paraflow-block-code-color,var(--code-normal)); }
.paraflow-code-syntax-line .cm-hmd-codeblock { color:inherit!important; }
.paraflow-code-heading.paraflow-code-heading--indented { height:0;border:0;background:transparent;overflow:visible; }
.paraflow-code-ending.paraflow-code-ending--indented { height:0;border:0;background:transparent; }
.paraflow-code-heading {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: var(--paraflow-block-code-padding-top, max(.65em, calc(var(--font-text-size, 1rem) * .6875 - 1px)));
  padding: 0;
  background: var(--paraflow-block-code-background, var(--code-background, var(--background-secondary)));
  border-radius: var(--paraflow-block-code-radius, 3px) var(--paraflow-block-code-radius, 3px) 0 0;
  border: var(--paraflow-block-code-border, 1px solid var(--background-modifier-border));
  border-bottom: 0;
  box-sizing: content-box;
}
.cm-content > .paraflow-code-heading,
.cm-content > .paraflow-container-block > .paraflow-code-heading,
.markdown-source-view.mod-cm6 .cm-editor .cm-content > .paraflow-code-heading {
  display: flex !important;
  contain: none !important;
  z-index: 2;
}
.paraflow-code-ending {
  height: var(--paraflow-block-code-padding-bottom, max(.65em, calc(var(--font-text-size, 1rem) * .6875 - 1px)));
  box-sizing: content-box;
  background: var(--paraflow-block-code-background, var(--code-background, var(--background-secondary)));
  border: var(--paraflow-block-code-border, 1px solid var(--background-modifier-border));
  border-top: 0;
  border-radius: 0 0 var(--paraflow-block-code-radius, 3px) var(--paraflow-block-code-radius, 3px);
}
.paraflow-code-ending-space {
  font-size: var(--font-text-size, 1rem);
  padding-bottom: 0;
}
.paraflow-code-heading, .paraflow-code-ending {
  font-family: var(--paraflow-block-code-font, var(--font-monospace));
  font-size: var(--paraflow-block-code-size, 0.9em);
}
.cm-line.paraflow-code-draft,
.cm-line.paraflow-code-draft span:not(.paraflow-callout-rails):not(.paraflow-callout-rail) {
  color: var(--text-faint) !important;
  font-family: inherit !important;
  font-size: inherit !important;
  font-style: normal !important;
  font-weight: normal !important;
  background: transparent !important;
}
.cm-content > .cm-line.paraflow-code-draft {
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
}
.cm-content > .cm-line.paraflow-code-draft:not(.HyperMD-list-line):not(.paraflow-list-owned-line) {
  font: inherit !important;
  line-height: inherit !important;
}
.cm-content > .cm-line.paraflow-code-draft:not(.paraflow-callout-line):not(.HyperMD-list-line):not(.paraflow-list-owned-line) {
  padding-block: 0 !important;
  padding-inline: 0 !important;
  text-indent: 0 !important;
}
.cm-line.paraflow-code-draft::before { display: none !important; }
.markdown-source-view.mod-cm6.is-live-preview .cm-content > :is(.paraflow-code-heading,.paraflow-code-ending-space,.paraflow-code-ending,.paraflow-code-scroll),
.cm-content > :is(.paraflow-code-heading,.paraflow-code-ending-space,.paraflow-code-ending,.paraflow-code-scroll),
.cm-content > .paraflow-container-block > :is(.paraflow-code-heading,.paraflow-code-ending-space,.paraflow-code-ending,.paraflow-code-scroll),
.cm-content > .cm-line.paraflow-code-fenced-list:not(.paraflow-callout-line) {
  margin-inline-start: var(--paraflow-code-list-inset, 0px) !important;
}
.paraflow-code-heading .paraflow-code-edit-syntax {
  position: absolute;
  bottom: 0;
  right: 0.65em;
  z-index: 3;
  opacity: 0.55;
  border-radius: 3px;
  background: var(--paraflow-block-code-background, var(--code-background, var(--background-secondary)));
}
.paraflow-code-heading .paraflow-code-edit-syntax:hover,
.paraflow-code-heading .paraflow-code-edit-syntax:focus-visible { opacity: 1; }
.paraflow-code-heading button {
  background: transparent;
  box-shadow: none;
  border: 0;
  color: var(--text-muted);
  font-size: calc(var(--font-text-size, 1rem) * 0.75);
  height: auto;
  padding: 0;
  cursor: pointer;
}
.paraflow-code-language-popup {
  position: fixed;
  z-index: var(--layer-popover, 1000);
  width: 10.625em;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  padding: 0;
  border-radius: 3px;
  background: var(--code-background, var(--background-secondary));
  color: var(--text-normal);
  box-shadow: none;
}
.paraflow-code-language-popup input[type="text"] {
  display: block;
  width: 100%;
  height: 2.1666667em;
  box-sizing: border-box;
  padding: 0.1666667em 0.5em;
  margin: 0;
  border: 1px solid var(--background-modifier-border);
  border-radius: 3px;
  background: inherit;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 0.75em;
  line-height: 1.6666667;
  text-align: center;
  box-shadow: none;
}
.paraflow-code-language-popup input[aria-invalid="true"] { border-color: var(--text-error); }
.paraflow-code-language-suggestions {
  position: absolute; inset: 100% 0 auto; max-height: 15em; overflow-y: auto;
  background: var(--background-primary); border: 1px solid var(--background-modifier-border);
  border-radius: 4px; box-shadow: var(--shadow-s);
}
.paraflow-code-language-suggestions.is-above { inset: auto 0 100%; }
.paraflow-code-language-suggestions button {
  display: flex; align-items: center; gap: .6em; width: 100%; border: 0; border-radius: 0; box-shadow: none;
  text-align: left; background: transparent; padding: .3em .6em; font-size: .85em;
}
.paraflow-code-language-icon {
  flex: none; width: 1em; height: 1em; fill: none; stroke: currentColor; stroke-width: 1.5;
  stroke-linecap: round; stroke-linejoin: round; color: var(--color-green, #699b35);
}
.paraflow-code-language-icon[data-category="script"] { color: var(--color-purple, #9470c4); }
.paraflow-code-language-icon[data-category="terminal"] { color: var(--color-cyan, #289c9c); }
.paraflow-code-language-icon[data-category="markup"] { color: var(--color-orange, #bc7a36); }
.paraflow-code-language-icon[data-category="data"] { color: var(--color-blue, #538ac5); }
.paraflow-code-language-icon[data-category="diagram"] { color: var(--color-pink, #b8689a); }
.paraflow-code-language-icon[data-category="text"] { color: var(--text-muted); }
.paraflow-code-language-suggestions button:is(:hover,[aria-selected="true"]) { background: var(--background-modifier-hover); }
.paraflow-code-language-popup[data-position="bottom-right"] input[type="text"] {
  border-bottom-color: var(--background-modifier-border-hover, var(--text-faint));
}
.paraflow-code-line, .paraflow-code-row {
  --paraflow-code-number-gap: 0.5em;
  --paraflow-code-text-gap: calc(var(--paraflow-code-number-text-gap, 0.65em) + var(--paraflow-code-inner-padding-left, 0px));
  --paraflow-code-gutter: calc(var(--paraflow-code-number-digits, 1) * 1ch + var(--paraflow-code-number-gap) + var(--paraflow-code-number-padding-left, 0px) + 1px);
}
.cm-line.paraflow-code-line {
  --paraflow-code-inset: var(--paraflow-block-code-padding-left, 0.65em);
  position: relative;
  overflow-x: hidden !important;
  white-space: pre !important;
  overflow-wrap: normal !important;
  word-break: normal !important;
  max-width: 100%;
  box-sizing: border-box;
  text-indent: 0 !important;
  font-family: var(--paraflow-block-code-font, var(--font-monospace));
  font-size: var(--paraflow-block-code-size, 0.9em);
  padding-inline-start: var(--paraflow-code-inset) !important;
  padding-inline-end: var(--paraflow-block-code-padding-right, .65em) !important;
  padding-block: 0 !important;
  border-inline: var(--paraflow-block-code-border, 1px solid var(--background-modifier-border)) !important;
  border-block: 0;
  border-radius: 0;
  background: var(--paraflow-block-code-background, var(--code-background, var(--background-secondary))) !important;
  line-height: var(--paraflow-block-code-line-height, var(--code-line-height, 1.6)) !important;
  min-height: 1lh !important;
  height: auto !important;
}
/* An inline gutter changes Chromium's caret rounding next to the virtual glyph. */
.cm-line.paraflow-code-line:is(.paraflow-code-wrap,.paraflow-code-virtual)[data-paraflow-line] {
  padding-inline-start: calc(var(--paraflow-code-inset) + var(--paraflow-code-gutter) + var(--paraflow-code-text-gap)) !important;
  text-indent: 0;
}
.cm-line.paraflow-code-line[data-paraflow-line] {
  --paraflow-code-local-inset: var(--paraflow-code-numbered-inset, var(--paraflow-block-code-padding-left, 0.65em));
  --paraflow-code-inset: var(--paraflow-code-local-inset);
}
.paraflow-code-wrap .paraflow-code-row[data-paraflow-line] {
  padding-inline-start: calc(var(--paraflow-code-gutter) + var(--paraflow-code-text-gap));
  text-indent: 0;
}
.cm-line.paraflow-code-line.paraflow-code-wrap {
  white-space: pre-wrap !important;
  overflow-wrap: anywhere !important;
}
.cm-content > .cm-line.paraflow-callout-line.paraflow-code-line {
  --paraflow-code-inset: calc(var(--paraflow-container-inset) + var(--paraflow-code-frame-border-left, 0px) + var(--paraflow-code-local-inset, var(--paraflow-block-code-padding-left, .65em)));
  --paraflow-container-end-inset: calc(var(--paraflow-container-callouts) * var(--paraflow-callout-padding, 12px));
  border-inline: 0 !important;
  padding-inline-end: calc(var(--paraflow-container-end-inset) + var(--paraflow-code-frame-border-right, 0px) + var(--paraflow-block-code-padding-right, .65em)) !important;
  background: linear-gradient(to right, transparent var(--paraflow-container-inset), var(--paraflow-block-code-background, var(--code-background, var(--background-secondary))) var(--paraflow-container-inset), var(--paraflow-block-code-background, var(--code-background, var(--background-secondary))) calc(100% - var(--paraflow-container-end-inset)), transparent calc(100% - var(--paraflow-container-end-inset))) !important;
}
.cm-line.paraflow-code-indented {
  --paraflow-code-list-inset: calc(var(--paraflow-code-list-depth, 0) * var(--paraflow-live-list-indent, 30px));
  background: var(--code-background, var(--background-secondary));
  color: var(--code-normal);
}
/* The host resets direct content-child margins with !important. */
.cm-content > .cm-line.paraflow-code-indented:not(.paraflow-callout-line) {
  margin-inline-start: var(--paraflow-code-list-inset) !important;
}
.cm-line.paraflow-code-indented.paraflow-code-start:not(.paraflow-callout-line) {
  border-top: var(--paraflow-block-code-border, 1px solid var(--background-modifier-border));
  border-start-start-radius: var(--paraflow-block-code-radius, 3px);
  border-start-end-radius: var(--paraflow-block-code-radius, 3px);
}
.cm-line.paraflow-code-indented.paraflow-code-end:not(.paraflow-callout-line) {
  border-bottom: var(--paraflow-block-code-border, 1px solid var(--background-modifier-border));
  border-end-start-radius: var(--paraflow-block-code-radius, 3px);
  border-end-end-radius: var(--paraflow-block-code-radius, 3px);
}
.cm-content > .cm-line.paraflow-callout-line:is(.paraflow-code-indented,.paraflow-code-fenced-list) {
  margin-inline-start: 0;
  --paraflow-code-inset: calc(var(--paraflow-container-inset) + var(--paraflow-code-list-inset) + var(--paraflow-code-frame-border-left, 0px) + var(--paraflow-code-local-inset, var(--paraflow-block-code-padding-left, .65em)));
  background: linear-gradient(to right, transparent calc(var(--paraflow-container-inset) + var(--paraflow-code-list-inset)), var(--paraflow-block-code-background, var(--code-background, var(--background-secondary))) calc(var(--paraflow-container-inset) + var(--paraflow-code-list-inset)), var(--paraflow-block-code-background, var(--code-background, var(--background-secondary))) calc(100% - var(--paraflow-container-end-inset)), transparent calc(100% - var(--paraflow-container-end-inset))) !important;
}
.cm-content > .cm-line.paraflow-callout-line.paraflow-code-line::after {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline: calc(var(--paraflow-container-inset) + var(--paraflow-code-list-inset, 0px)) var(--paraflow-container-end-inset);
  box-sizing: border-box;
  border-inline: var(--paraflow-block-code-border, 1px solid var(--background-modifier-border));
  pointer-events: none;
  z-index: 2;
}
.cm-content > .cm-line.paraflow-callout-line.paraflow-code-indented::after {
  transform: translateX(var(--paraflow-code-scroll-offset, 0px));
}
.cm-content > .cm-line.paraflow-callout-line.paraflow-code-indented.paraflow-code-start::after {
  border-top: var(--paraflow-block-code-border, 1px solid var(--background-modifier-border));
  border-start-start-radius: var(--paraflow-block-code-radius, 3px);
  border-start-end-radius: var(--paraflow-block-code-radius, 3px);
}
.cm-content > .cm-line.paraflow-callout-line.paraflow-code-indented.paraflow-code-end::after {
  border-bottom: var(--paraflow-block-code-border, 1px solid var(--background-modifier-border));
  border-end-start-radius: var(--paraflow-block-code-radius, 3px);
  border-end-end-radius: var(--paraflow-block-code-radius, 3px);
}
.cm-line.paraflow-code-line .cm-inline-code {
  background: transparent !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  font: inherit !important;
  color: inherit !important;
}
.cm-line.paraflow-code-indented .cm-indent::before { display: none !important; }
.paraflow-code-line[data-paraflow-line]::before,
.markdown-source-view.mod-cm6.is-live-preview .cm-line.paraflow-code-line[data-paraflow-line]::before,
.paraflow-code-row[data-paraflow-line]::before {
  content: attr(data-paraflow-line);
  display: inline-block;
  position: sticky;
  left: 0;
  top: auto;
  bottom: auto;
  height: auto;
  z-index: 1;
  width: var(--paraflow-code-gutter);
  padding-right: var(--paraflow-code-number-gap);
  padding-left: var(--paraflow-code-number-padding-left, 0px);
  border-right: 1px solid var(--paraflow-border-color, var(--background-modifier-border));
  border-left: 0;
  margin-right: var(--paraflow-code-text-gap);
  box-sizing: border-box;
  text-align: right;
  text-indent: 0;
  color: var(--text-faint);
  background: var(--paraflow-block-code-background, var(--code-background, var(--background-secondary)));
  font-variant-numeric: tabular-nums;
  user-select: none;
  pointer-events: none;
}
.paraflow-code-line:is(.paraflow-code-wrap,.paraflow-code-virtual)[data-paraflow-line]::before,
.markdown-source-view.mod-cm6.is-live-preview .cm-line.paraflow-code-line:is(.paraflow-code-wrap,.paraflow-code-virtual)[data-paraflow-line]::before,
.paraflow-code-wrap .paraflow-code-row[data-paraflow-line]::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
}
.paraflow-code-line:is(.paraflow-code-wrap,.paraflow-code-virtual)[data-paraflow-line]::before,
.markdown-source-view.mod-cm6.is-live-preview .cm-line.paraflow-code-line:is(.paraflow-code-wrap,.paraflow-code-virtual)[data-paraflow-line]::before { left: var(--paraflow-code-inset); }
.paraflow-code-scroll {
  --paraflow-code-list-inset: calc(var(--paraflow-code-list-depth, 0) * var(--paraflow-live-list-indent, 30px));
  margin-inline-start: var(--paraflow-code-list-inset);
  border-inline: var(--paraflow-block-code-border, 1px solid var(--background-modifier-border));
  box-sizing: border-box;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  height: 14px;
  background: var(--paraflow-block-code-background, var(--code-background, var(--background-secondary)));
}
.paraflow-code-scroll[hidden] { display: none !important; }
.paraflow-container-block[hidden]:has(> .paraflow-code-scroll) { display: none !important; }
.paraflow-code-scroll-track { height: 1px; }
.paraflow-code-extent { display: inline-block; height: 0; pointer-events: none; user-select: none; }
pre.paraflow-code-display {
  position: relative;
  font-family: var(--paraflow-block-code-font, var(--font-monospace));
  font-size: var(--paraflow-block-code-size, .9em);
  color: var(--paraflow-block-code-color, var(--code-normal));
  max-width: 100%;
  overflow-x: auto !important;
  white-space: pre !important;
  padding-top: var(--paraflow-block-code-padding-top, max(.65em, calc(var(--font-text-size, 1rem) * .6875 - 1px))) !important;
  padding-bottom: var(--paraflow-block-code-padding-bottom, max(.65em, calc(var(--font-text-size, 1rem) * .6875 - 1px))) !important;
  padding-left: var(--paraflow-block-code-padding-left, .65em) !important;
  padding-right: var(--paraflow-block-code-padding-right, .65em) !important;
  line-height: var(--paraflow-block-code-line-height, var(--code-line-height, 1.6)) !important;
  border: var(--paraflow-block-code-border, 1px solid var(--background-modifier-border));
}
pre.paraflow-code-display.paraflow-code-numbered-lines {
  padding-left: var(--paraflow-code-numbered-inset, var(--paraflow-block-code-padding-left, .65em)) !important;
}
pre.paraflow-code-display > code {
  display: block;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
  padding: 0;
  width: max-content;
  min-width: 100%;
  white-space: pre !important;
  overflow-wrap: normal !important;
  word-break: normal !important;
}
.paraflow-code-row { position: relative; display: block; min-height: 1lh; white-space: inherit; box-sizing: border-box; }
pre.paraflow-code-display.paraflow-code-wrap > code {
  width: auto;
  white-space: pre-wrap !important;
  overflow-wrap: anywhere !important;
}
.paraflow-code-copy { position: sticky; right: 0; float: right; font-size: var(--font-smallest); }
.paraflow-code-display-frame {
  position: relative;
  font-size: var(--font-text-size, 1rem);
  padding-bottom: 0;
}
.paraflow-code-display-frame > pre.paraflow-code-display { margin-block: 0 !important; }
.paraflow-code-language {
  position: absolute;
  right: 0;
  bottom: .0833333em;
  box-sizing: border-box;
  height: 2.1666667em;
  max-width: 100%;
  padding: .1666667em .5em;
  line-height: 1.6666667;
  color: var(--text-muted);
  font-size: .75em;
  user-select: none;
  pointer-events: none;
}
@media print {
  .cm-line.paraflow-code-line[data-paraflow-line] {
    padding-inline-start: calc(var(--paraflow-code-inset) + var(--paraflow-code-gutter) + var(--paraflow-code-text-gap)) !important;
    text-indent: 0;
  }
  .paraflow-code-row[data-paraflow-line] { padding-inline-start: calc(var(--paraflow-code-gutter) + var(--paraflow-code-text-gap)); text-indent: 0; }
  .paraflow-code-ending-space { padding-bottom: 0; }
  .paraflow-code-display-frame { padding-bottom: 0; }
  .paraflow-code-language { display: none; }
  .cm-line.paraflow-code-line,
  pre.paraflow-code-display,
  pre.paraflow-code-display > code {
    white-space: pre-wrap !important;
    overflow-wrap: anywhere !important;
    word-break: normal !important;
    overflow: visible !important;
    width: auto !important;
    max-width: 100% !important;
  }
  .paraflow-code-scroll, .paraflow-code-copy, .paraflow-code-extent, .paraflow-code-language-popup { display: none !important; }
  .paraflow-code-line[data-paraflow-line]::before,
  .markdown-source-view.mod-cm6.is-live-preview .cm-line.paraflow-code-line[data-paraflow-line]::before,
  .paraflow-code-row[data-paraflow-line]::before { position: absolute; top: 0; bottom: 0; left: 0; }
  .paraflow-code-line[data-paraflow-line]::before,
  .markdown-source-view.mod-cm6.is-live-preview .cm-line.paraflow-code-line[data-paraflow-line]::before { left: var(--paraflow-code-inset); }
}
`;
