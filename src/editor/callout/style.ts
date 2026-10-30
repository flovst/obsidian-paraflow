/** Both projections use the same type color and retain their existing editing surfaces. */
export const CALLOUT_STYLE_CSS = `
.cm-editor[data-paraflow-callout-style="obsidian"] .cm-content > :is(.paraflow-callout-line, .paraflow-container-block, .paraflow-container-boundary-gap) { isolation: isolate; }
.cm-editor[data-paraflow-callout-style="obsidian"] .paraflow-callout-rails { z-index: -1; }
.cm-editor[data-paraflow-callout-style="obsidian"] .paraflow-callout-rails > .paraflow-callout-rail.callout {
  width: auto;
  inset-inline-end: calc(var(--paraflow-rail-callouts) * var(--paraflow-callout-padding, 12px));
  background: color-mix(in srgb, var(--callout-color) 10%, transparent);
}
.cm-editor[data-paraflow-callout-style="obsidian"] .paraflow-callout-rail.callout[data-paraflow-rail-start] { border-start-start-radius: var(--callout-radius, 4px); border-start-end-radius: var(--callout-radius, 4px); }
.cm-editor[data-paraflow-callout-style="obsidian"] .paraflow-callout-rail.callout[data-paraflow-rail-end],
.cm-editor[data-paraflow-callout-style="obsidian"] .paraflow-callout-collapsed .paraflow-callout-rail.callout:last-child { border-end-start-radius: var(--callout-radius, 4px); border-end-end-radius: var(--callout-radius, 4px); }
.markdown-reading-view .callout.paraflow-display-callout[data-paraflow-callout-style="obsidian"],
.markdown-source-view.mod-cm6.is-live-preview .cm-editor.paraflow-callout-active[data-paraflow-callout-style="obsidian"] .cm-content .cm-callout > .callout[data-callout] {
  background: color-mix(in srgb, var(--callout-color) 10%, transparent);
  border-radius: var(--callout-radius, 4px);
}
.markdown-reading-view .callout.paraflow-display-callout[data-paraflow-callout-style="obsidian"]::before,
.cm-editor[data-paraflow-callout-style="obsidian"] .cm-callout > .callout::before { display: none; }
`;
