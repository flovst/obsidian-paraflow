export const MEDIA_TABLE_CSS = `
.paraflow-table-terminal-break::after { content:''; display:inline-block; width:0; height:1lh; vertical-align:top; }
/* Native block replacement leaves an empty source carrier before the rendered table. */
.markdown-source-view.mod-cm6.is-live-preview .paraflow-table-display-active .cm-line.HyperMD-table-row:has(>br:only-child):has(+.cm-table-widget) { height:0!important; min-height:0!important; line-height:0!important; padding-block:0!important; }
/* Native cells freeze their dimensions before the display observer runs. */
.markdown-source-view.mod-cm6:where(.is-live-preview) :where(.paraflow-table-display-active) .cm-table-widget,
.markdown-source-view.mod-cm6.is-live-preview .cm-table-widget.paraflow-display-table-widget { padding:0; margin-inline:0 !important; }
.markdown-source-view.mod-cm6:where(.is-live-preview) :where(.paraflow-table-display-active) .cm-table-widget .table-wrapper { width:100%; }
.markdown-source-view.mod-cm6:where(.is-live-preview) :where(.paraflow-table-display-active) .cm-table-widget .table-cell-wrapper { padding:0; height:auto; }
.markdown-source-view.mod-cm6:where(.is-live-preview) :where(.paraflow-table-display-active) .cm-table-widget .table-cell-wrapper :is(.cm-scroller,.cm-content) { line-height:inherit; }
.markdown-source-view.mod-cm6.is-live-preview :is(.paraflow-table-display-active.paraflow-paragraph-editing-active,.paraflow-table-display-active.paraflow-callout-active .paraflow-container-block) :is(.cm-table-widget,.paraflow-html-table-editor,table.table-editor,table.paraflow-editable-table) { margin-block:0; }
/* The semantic gap owns standalone native HTML table spacing too. */
.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-table-display-active.paraflow-paragraph-editing-active > .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content > .cm-html-embed > table.paraflow-display-table { margin-block:0; }
.markdown-source-view.mod-cm6:where(.is-live-preview) :where(.paraflow-table-display-active) :is(table.table-editor,table.paraflow-editable-table) { width:100%; table-layout:auto; border-collapse:collapse; line-height:var(--paraflow-line-height,var(--line-height-normal,1.6)); }
.markdown-source-view.mod-cm6:where(.is-live-preview) :where(.paraflow-table-display-active) :is(table.table-editor,table.paraflow-editable-table) > :where(thead,tbody,tfoot) > tr > :is(td,th) { border:1px solid var(--paraflow-border-color); padding:6px 13px; line-height:inherit; vertical-align:middle; }
.markdown-source-view.mod-cm6:where(.is-live-preview) :where(.paraflow-table-display-active) :is(table.table-editor,table.paraflow-editable-table) > :where(thead,tbody,tfoot) > tr > th:not([style*="font-weight" i],:is(table,thead,tbody,tfoot,tr)[style*="font-weight" i] *) { font-weight:var(--font-bold,700); }
.markdown-source-view.mod-cm6:where(.is-live-preview) :where(.paraflow-table-display-active) :is(table.table-editor,table.paraflow-editable-table) > :where(thead,tbody,tfoot) > tr > th:not([style*="background" i],:is(table,thead,tbody,tfoot,tr)[style*="background" i] *) { background-color:var(--paraflow-table-header-background,var(--paraflow-surface-color,var(--background-secondary))); }
.markdown-source-view.mod-cm6:where(.is-live-preview) :where(.paraflow-table-display-active) :is(table.table-editor,table.paraflow-editable-table) > :where(thead,tbody,tfoot) > tr > td:not([style*="background" i],:is(table,thead,tbody,tfoot,tr)[style*="background" i] *) { background-color:var(--paraflow-table-base-background,var(--background-primary)); }
.markdown-source-view.mod-cm6:where(.is-live-preview) :where(.paraflow-table-display-active) :is(table.table-editor > tbody > tr:nth-child(even) > td,table.paraflow-editable-table > :where(thead,tbody,tfoot) > tr > td[data-pf-stripe="0"]):not([style*="background" i],:is(table,thead,tbody,tfoot,tr)[style*="background" i] *) { background-color:var(--paraflow-table-stripe-background,var(--paraflow-surface-color,var(--background-secondary))); }
.markdown-source-view.mod-cm6.is-live-preview .paraflow-table-wrap-active :is(table.table-editor,table.paraflow-editable-table) > :where(thead,tbody,tfoot) > tr > :is(td,th) { white-space:normal; overflow-wrap:anywhere; word-break:normal; }
.markdown-source-view.mod-cm6.is-live-preview .paraflow-table-wrap-active :is(table.table-editor,table.paraflow-editable-table) :is(.table-cell-wrapper,.cm-scroller,.cm-content,.cm-line) { white-space:normal; overflow-wrap:inherit; word-break:normal; }
.markdown-source-view.mod-cm6.is-live-preview .paraflow-table-wrap-active :is(table.table-editor,table.paraflow-editable-table) .cm-content { white-space:break-spaces; }
.markdown-source-view.mod-cm6.is-live-preview .paraflow-table-nowrap-active :is(table.table-editor,table.paraflow-editable-table) > :where(thead,tbody,tfoot) > tr > :is(td,th),
.markdown-source-view.mod-cm6.is-live-preview .paraflow-table-nowrap-active :is(table.table-editor,table.paraflow-editable-table) .table-cell-wrapper { white-space:nowrap; overflow-wrap:normal; word-break:normal; }
.markdown-source-view.mod-cm6.is-live-preview .paraflow-table-nowrap-active :is(table.table-editor,table.paraflow-editable-table) :is(.cm-scroller,.cm-content,.cm-line) { white-space:pre; overflow-wrap:normal; word-break:normal; }
img.paraflow-display-image { max-width: 100%; }
img.paraflow-display-image-natural-height { height: auto; }
img.paraflow-display-image-constrained { height: var(--paraflow-image-constrained-height) !important; }
img.paraflow-display-image-center { display: block; margin-inline: auto; }
.paraflow-display-image-container { display: block; max-width: 100%; }
.cm-content .image-embed.paraflow-display-image-container { display: inline-block; width: 100%; vertical-align: bottom; }
.image-embed > .image-wrapper.paraflow-display-image-frame { display: block; width: fit-content; max-width: 100%; margin-inline: auto; }
.paraflow-display-table-viewport { max-width: 100%; overflow-x: auto; }
.markdown-source-view.mod-cm6.is-live-preview .cm-table-widget .table-wrapper.paraflow-display-table-wrapper { width: 100%; }
.cm-table-widget table.paraflow-display-table .is-selected::after,
.cm-table-widget.is-selected table.paraflow-display-table::after,
.markdown-source-view.mod-cm6 .cm-table-widget table.paraflow-display-table .is-selected::after,
.markdown-source-view.mod-cm6 .cm-table-widget.is-selected table.paraflow-display-table::after { inset: 0; }
table.paraflow-display-table { width: 100%; table-layout: auto; border-collapse: collapse; }
:is(.markdown-source-view.mod-cm6.is-live-preview, .markdown-reading-view) table.paraflow-display-table { line-height: var(--paraflow-line-height, var(--line-height-normal, 1.6)); }
.markdown-source-view.mod-cm6 table.paraflow-display-table > :where(thead, tbody, tfoot) > tr > :is(td, th),
.markdown-reading-view table.paraflow-display-table > :where(thead, tbody, tfoot) > tr > :is(td, th) { border: 1px solid var(--paraflow-border-color); padding: 6px 13px; line-height: inherit; vertical-align: middle; }
.markdown-reading-view table.paraflow-display-table { line-height: var(--paraflow-line-height, var(--line-height-normal, 1.6)); }
.markdown-reading-view table.paraflow-display-table > :is(thead, tbody, tfoot) > tr > th { line-height: inherit; }
.markdown-reading-view table.paraflow-display-table > :is(thead, tbody, tfoot) > tr > :is(td, th):empty::before { content: "\\200b"; }
table.paraflow-display-table-self-scroll { display: block; width: max-content; max-width: 100%; overflow-x: auto; }
table.paraflow-display-table > :is(thead, tbody, tfoot) > tr > :is(th, td) { white-space: normal; overflow-wrap: anywhere; }
table.paraflow-table-wrap > :is(thead, tbody, tfoot) > tr > :is(td,th) { white-space:normal; overflow-wrap:anywhere; word-break:normal; }
table.paraflow-table-wrap > :is(thead, tbody, tfoot) > tr > .paraflow-table-cell-keep-words,
.markdown-source-view.mod-cm6.is-live-preview table.paraflow-table-wrap > :is(thead, tbody, tfoot) > tr > .paraflow-table-cell-keep-words { overflow-wrap:normal; }
.markdown-source-view.mod-cm6.is-live-preview :is(.cm-table-widget,.paraflow-html-table-editor) table.paraflow-table-wrap :is(.table-cell-wrapper,.cm-scroller,.cm-content,.cm-line) { white-space:normal; overflow-wrap:inherit; word-break:normal; }
.markdown-source-view.mod-cm6.is-live-preview :is(.cm-table-widget,.paraflow-html-table-editor) table.paraflow-table-wrap .cm-content { white-space:break-spaces; }
table.paraflow-table-nowrap > :is(thead, tbody, tfoot) > tr > :is(td,th),
.markdown-source-view.mod-cm6.is-live-preview :is(.cm-table-widget,.paraflow-html-table-editor) table.paraflow-table-nowrap .table-cell-wrapper { white-space:nowrap; overflow-wrap:normal; word-break:normal; }
.markdown-source-view.mod-cm6.is-live-preview :is(.cm-table-widget,.paraflow-html-table-editor) table.paraflow-table-nowrap :is(.cm-scroller,.cm-content,.cm-line) { white-space:pre; overflow-wrap:normal; word-break:normal; }
table.paraflow-display-table > :where(thead, tbody, tfoot) > tr > .paraflow-display-cell-base:where(:not([style*="background" i])),
:is(.markdown-source-view.mod-cm6.is-live-preview, .markdown-reading-view, .markdown-rendered) table.paraflow-display-table > :where(thead, tbody, tfoot) > tr > :is(td, th).paraflow-display-cell-base:where(:not([style*="background" i])) { background-color: var(--paraflow-table-base-background, var(--background-primary)); }
table.paraflow-display-table > :where(thead, tbody, tfoot) > tr > .paraflow-display-cell-stripe:where(:not([style*="background" i])),
:is(.markdown-source-view.mod-cm6.is-live-preview, .markdown-reading-view, .markdown-rendered) table.paraflow-display-table > :where(thead, tbody, tfoot) > tr > :is(td, th).paraflow-display-cell-stripe:where(:not([style*="background" i])) { background-color: var(--paraflow-table-stripe-background, var(--paraflow-surface-color, var(--background-secondary))); }
table.paraflow-display-table > :where(thead, tbody, tfoot) > tr > .paraflow-display-header:where(:not([style*="background" i])),
:is(.markdown-source-view.mod-cm6.is-live-preview, .markdown-reading-view, .markdown-rendered) table.paraflow-display-table > :where(thead, tbody, tfoot) > tr > :is(td, th).paraflow-display-header:where(:not([style*="background" i])) { background-color: var(--paraflow-table-header-background, var(--paraflow-surface-color, var(--background-secondary))); }
table.paraflow-display-table > :is(thead, tbody, tfoot) > tr > .paraflow-display-header-weight { font-weight: var(--font-bold, 700); }
`;
