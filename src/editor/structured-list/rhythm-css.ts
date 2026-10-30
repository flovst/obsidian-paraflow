const listOwner = '.markdown-source-view.mod-cm6.is-live-preview > .cm-editor:is(.paraflow-structured-list-active,.paraflow-callout-active)';
const item = ':is(.HyperMD-list-line,.paraflow-list-owned-line):not(.paraflow-list-owned-blank-line)';

/** Source body and containers consume the same list row geometry. */
export const LIST_RHYTHM_CSS = `
${listOwner}{--paraflow-live-list-content-offset:.75em}
${listOwner} .paraflow-list-continuation-line:not(.paraflow-list-empty-body-line){padding-block:0}
${listOwner} .cm-line.paraflow-list-owned-line.paraflow-list-continuation-line:not(.paraflow-list-empty-body-line){padding-block-start:0}
${listOwner} ${item}[data-paraflow-list-rhythm~="continuation-before"][data-paraflow-list-rhythm]{padding-block-end:0}
${listOwner} .paraflow-list-continuation-line[data-paraflow-list-rhythm~="continuation-end"][data-paraflow-list-rhythm]{
 padding-block-end:var(--paraflow-list-row-padding,.25em);
}
${listOwner} ${item} + .paraflow-list-owned-blank-line[data-paraflow-list-rhythm~="blank-between"][data-paraflow-list-rhythm]{
 min-height:calc(2 * var(--paraflow-list-row-padding,.25em));
 line-height:calc(2 * var(--paraflow-list-row-padding,.25em));
}
${listOwner} ${item}[data-paraflow-list-rhythm~="blank-before"][data-paraflow-list-rhythm][data-paraflow-list-rhythm]{padding-block-end:0}
${listOwner} ${item} + .paraflow-list-owned-blank-line + ${item}{padding-block-start:0}
`;
