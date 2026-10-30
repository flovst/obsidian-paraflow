export const TABLE_EDITING_CSS=`
.paraflow-table-break-hints { position:fixed; overflow:hidden; pointer-events:none; z-index:1; }
.paraflow-table-break-hint { position:absolute; color:var(--paraflow-source-color,var(--text-faint)); white-space:nowrap; overflow:hidden; user-select:none; }
.paraflow-table-break-hint-rich { box-sizing:border-box; padding-inline-start:.12em; }
.paraflow-table-break-spacer { display:inline; user-select:none; pointer-events:none; }
.paraflow-table-break-spacer::before { content:'<br>'; visibility:hidden; white-space:nowrap; }
.paraflow-html-table-editor { --no-tooltip:true; max-width:100%; overflow-x:auto; margin-block:0.8em; }
.paraflow-html-table-editor table { width:100%; max-width:100%; border-collapse:collapse; table-layout:auto; }
.markdown-source-view.mod-cm6.is-live-preview :is(.cm-editor.paraflow-paragraph-editing-active,.cm-editor.paraflow-callout-active .paraflow-container-block) :is(.cm-table-widget.paraflow-table-controls,.paraflow-html-table-editor) { margin-block:0; }
.markdown-source-view.mod-cm6.is-live-preview :is(.cm-editor.paraflow-paragraph-editing-active,.cm-editor.paraflow-callout-active .paraflow-container-block) :is(.cm-table-widget.paraflow-table-controls,.paraflow-html-table-editor) table.paraflow-display-table { margin-block:0; }
.paraflow-html-table-editor :is(td,th) { min-width:3em; vertical-align:middle; white-space:normal; overflow-wrap:anywhere; border:1px solid var(--table-border-color,var(--background-modifier-border)); outline:none; }
.markdown-source-view.mod-cm6 .cm-table-widget.paraflow-table-controls :is(td,th),.paraflow-html-table-editor :is(td,th) { padding:6px 13px; line-height:var(--paraflow-line-height,var(--line-height-normal,1.6)); vertical-align:middle; }
.markdown-source-view.mod-cm6 .cm-table-widget.paraflow-table-controls .table-cell-wrapper { padding:0; height:auto; }
.markdown-source-view.mod-cm6 .cm-table-widget.paraflow-table-controls .table-cell-wrapper :is(.cm-scroller,.cm-content) { line-height:inherit; }
/* Chromium paints the terminal BR caret just outside the nested scroller's left edge. */
.markdown-source-view.mod-cm6 .cm-table-widget.paraflow-table-controls .cm-editor.paraflow-native-cell-source > .cm-scroller { overflow:visible; }
.paraflow-html-table-editor th { text-align:start; }
.paraflow-html-table-editor :is(td,th):focus { outline:none; }
.paraflow-html-table-editor [aria-selected="true"] { --pf-selection-top:0px; --pf-selection-right:0px; --pf-selection-bottom:0px; --pf-selection-left:0px; outline:none; box-shadow:inset 0 var(--pf-selection-top) var(--interactive-accent),inset calc(-1 * var(--pf-selection-right)) 0 var(--interactive-accent),inset 0 calc(-1 * var(--pf-selection-bottom)) var(--interactive-accent),inset var(--pf-selection-left) 0 var(--interactive-accent),inset 0 0 0 9999px color-mix(in srgb,var(--interactive-accent) 14%,transparent); }
.paraflow-html-table-editor [data-pf-selection-edges~="top"] { --pf-selection-top:2px; }
.paraflow-html-table-editor [data-pf-selection-edges~="right"] { --pf-selection-right:2px; }
.paraflow-html-table-editor [data-pf-selection-edges~="bottom"] { --pf-selection-bottom:2px; }
.paraflow-html-table-editor [data-pf-selection-edges~="left"] { --pf-selection-left:2px; }
.paraflow-html-table-editor p { margin-block:0.35em; }
.paraflow-html-table-editor p:first-child { margin-top:0; }
.paraflow-html-table-editor p:last-child { margin-bottom:0; }
.paraflow-html-table-editor[data-pf-track-hover="row"] { cursor:row-resize; }
.paraflow-html-table-editor[data-pf-track-hover="column"] { cursor:col-resize; }
.paraflow-html-table-editor[data-pf-track-hover] :is(td,th) { cursor:inherit; }
.paraflow-html-table-editor[data-pf-track-drag="row"] { --paraflow-track-drag-cursor:row-resize; }
.paraflow-html-table-editor[data-pf-track-drag="column"] { --paraflow-track-drag-cursor:col-resize; }
.paraflow-html-table-editor[data-pf-track-drag],.paraflow-html-table-editor[data-pf-track-drag] * { cursor:var(--paraflow-track-drag-cursor) !important; user-select:none; }
.cm-table-widget.paraflow-table-controls .is-selected::after,
.cm-table-widget.paraflow-table-controls.is-selected table::after,
.markdown-source-view.mod-cm6 .cm-table-widget.paraflow-table-controls .is-selected::after,
.markdown-source-view.mod-cm6 .cm-table-widget.paraflow-table-controls.is-selected table::after { inset:0; }
.cm-table-widget.paraflow-table-controls .table-drag-target.mod-col::after { right:0; }
.cm-table-widget.paraflow-table-controls .table-drag-target.mod-row::after { bottom:0; }
.paraflow-table-drag-preview-layer { position:fixed; overflow:hidden; pointer-events:none; contain:strict; z-index:calc(var(--layer-menu,1000) - 3); }
.paraflow-table-drag-preview { position:absolute; left:0; top:0; opacity:.55; background:var(--background-primary); }
.paraflow-table-drag-preview-table { display:block; position:relative; margin:0; padding:0; border:0; border-collapse:collapse; }
.paraflow-table-drag-preview-table :is(tbody,tr) { display:block; }
.paraflow-table-drag-preview-table :is(td,th) { position:absolute; box-sizing:border-box; overflow:hidden; }
.paraflow-table-drag-cue { position:absolute; pointer-events:none; background:var(--interactive-accent); z-index:1; }
.paraflow-table-drag-cue[data-pf-axis="column"] { width:2px; }
.paraflow-table-drag-cue[data-pf-axis="row"] { height:2px; }
.paraflow-table-drag-cue[hidden],.paraflow-table-drag-preview-layer[hidden] { display:none; }
.cm-table-widget.paraflow-table-controls .table-col-drag-handle { left:0; top:0; width:100%; height:.35em; padding:0; opacity:1; border:0; background:transparent; cursor:col-resize; }
.cm-table-widget.paraflow-table-controls .table-row-drag-handle { left:0; top:0; height:100%; width:.35em; padding:0; opacity:1; border:0; background:transparent; cursor:row-resize; }
.cm-table-widget.paraflow-table-controls :is(.table-col-drag-handle,.table-row-drag-handle) :is(svg,.table-drag-handle),.cm-table-widget.paraflow-table-controls :is(.table-col-drag-handle,.table-row-drag-handle)::before,.cm-table-widget.paraflow-table-controls :is(.table-col-drag-handle,.table-row-drag-handle)::after { display:none; }
.markdown-source-view.mod-cm6 .cm-table-widget.paraflow-table-controls :is(.table-col-btn,.table-row-btn) { display:none; }
.paraflow-table-add-controls[hidden] { display:none; }
.paraflow-table-add-controls button { position:fixed; z-index:calc(var(--layer-menu,1000) - 3); display:flex; align-items:center; justify-content:center; padding:0; margin:0; min-width:0; min-height:0; border:0; box-shadow:none; border-radius:.15em; font:inherit; color:var(--text-muted); background:var(--background-modifier-hover); cursor:pointer; }
.paraflow-table-add-controls [data-pf-add="row"] { height:1em; }
.paraflow-table-add-controls [data-pf-add="column"] { width:1em; }
[data-pf-preview-role="th"] { font-weight:bold; background-color:var(--table-header-background,var(--background-secondary)); }
[data-pf-preview-role="td"] { font-weight:normal; }
.paraflow-table-dialog-check { display:flex; gap:.5em; align-items:center; }
.paraflow-table-dialog-buttons { display:flex; justify-content:flex-end; gap:.6em; margin-top:1em; }
.paraflow-table-dialog-error { color:var(--text-error); min-height:1.5em; }
.paraflow-table-format-input { width:100%; }
.paraflow-table-format-choices { display:flex; flex-wrap:wrap; gap:.4em; }
.paraflow-table-text-preview { position:fixed; z-index:calc(var(--layer-menu,1000) - 1); pointer-events:none; box-sizing:border-box; }
.paraflow-table-toolbar { position:fixed; z-index:calc(var(--layer-menu,1000) - 2); display:flex; justify-content:space-between; align-items:center; gap:.3em; padding-block:.15em; border:0; background:transparent; box-shadow:none; pointer-events:none; font-size:min(var(--font-ui-small),calc(var(--pf-toolbar-width) / 18)); }
.paraflow-table-toolbar[hidden] { display:none; }
.paraflow-table-toolbar-group { display:flex; align-items:center; gap:.15em; min-width:0; }
.paraflow-table-toolbar-start { display:flex; align-items:center; gap:.15em; min-width:0; }
.paraflow-table-toolbar-start > .paraflow-table-toolbar-group + .paraflow-table-toolbar-group { border-inline-start:1px solid var(--background-modifier-border); padding-inline-start:.35em; margin-inline-start:.2em; }
.paraflow-table-toolbar button { display:flex; align-items:center; justify-content:center; box-sizing:border-box; flex:0 1 1.7em; width:1.7em; height:1.4em; min-width:1em; min-height:0; margin:0; padding:0; font:inherit; line-height:1; border:0; border-radius:.15em; background:transparent; box-shadow:none; color:var(--text-muted); pointer-events:auto; }
.paraflow-table-toolbar button[data-pf-table-source-type] { flex:0 0 auto; width:auto; padding-inline:.3em; font-size:.78em; white-space:nowrap; }
.paraflow-table-toolbar button svg { display:block; flex:none; width:1.08em; height:1.08em; max-width:100%; }
.paraflow-table-toolbar button[aria-pressed="true"] { color:var(--interactive-accent); background:var(--background-modifier-hover); }
.paraflow-table-toolbar button:hover,.paraflow-table-toolbar button:focus-visible { background:var(--background-modifier-hover); color:var(--text-normal); }
.paraflow-table-toolbar button:focus-visible { outline:1px solid var(--interactive-accent); outline-offset:-1px; }
.paraflow-table-size-popup { position:fixed; z-index:var(--layer-menu,1000); padding:12px; width:17em; max-width:calc(100vw - 16px); border:1px solid var(--background-modifier-border); border-radius:var(--radius-m,6px); background:var(--background-primary); box-shadow:var(--shadow-s); font-size:var(--font-ui-small); }
.paraflow-table-size-grid { display:grid; grid-template-columns:repeat(8,1fr); gap:3px; margin-bottom:12px; }
.paraflow-table-size-grid button { padding:0; height:auto; aspect-ratio:1; border:1px solid var(--background-modifier-border); border-radius:2px; background:transparent; box-shadow:none; }
.paraflow-table-size-grid .is-active { background:color-mix(in srgb,var(--interactive-accent) 25%,transparent); border-color:var(--interactive-accent); }
.paraflow-table-size-inputs { display:flex; gap:12px; }
.paraflow-table-size-inputs label { flex:1; min-width:0; }
.paraflow-table-size-inputs input { display:block; width:100%; margin-top:4px; }
@media print { .paraflow-table-toolbar,.paraflow-table-size-popup { display:none; } }
`;
