const source = '.markdown-source-view.mod-cm6:not(.is-live-preview) > .cm-editor.paraflow-source-view';
export const sourceContentSelector = `:is(${source} > .cm-scroller > .cm-content,${source} > .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content)`;
const list = '.markdown-source-view.mod-cm6.is-live-preview > .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)';
const nativeOrigin = `${list} :where(.paraflow-structured-list-active *, .paraflow-callout-line):is(.HyperMD-list-line-1, .HyperMD-list-line-2, .HyperMD-list-line-3, .HyperMD-list-line-4, .HyperMD-list-line-5, .HyperMD-list-line-6, .paraflow-list-marker-line):not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line)`;

/** Source rows own paragraph indents, list hanging indents and prefix text origins. */
export const SOURCE_TEXT_ORIGIN_CSS = `
/* Keep two em of text space when a narrow editor cannot fit the full first-line indent. */
.markdown-source-view.mod-cm6.is-live-preview > .cm-editor .cm-content[contenteditable] > .cm-line.paraflow-body-paragraph.paraflow-body-indent::before {
  content: "";
  float: inline-start;
  width: clamp(0px, calc(100% - 2em), 2em);
  height: 1px;
}
${nativeOrigin} { --paraflow-list-origin-offset: calc(0px - var(--paraflow-live-list-content-offset) - var(--paraflow-live-list-hanging-indent)); }
.paraflow-list-origin-spacer {
  display: inline-block;
  inline-size: 0;
  block-size: 0;
  margin-inline-start: var(--paraflow-list-origin-offset);
}
`;
