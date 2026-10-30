/** Exact rows whose list layout owns the inline-start inset. */
export const LIST_LAYOUT_ROW_SELECTOR = `.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-1:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-2:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-3:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-4:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-5:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-6:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).paraflow-list-marker-line:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-1:not(.paraflow-math-source-block),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-2:not(.paraflow-math-source-block),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-3:not(.paraflow-math-source-block),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-4:not(.paraflow-math-source-block),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-5:not(.paraflow-math-source-block),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-6:not(.paraflow-math-source-block)`;

/** Live Preview list rows, native prefixes, markers and task carets share one layout surface. */
export const LIST_LAYOUT_CSS = `
.markdown-source-view.mod-cm6.is-live-preview .cm-editor.paraflow-callout-active .cm-callout .callout-content :is(ul, ol) {
	--list-marker-color: currentColor;
	--list-marker-color-hover: currentColor;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.cm-content[contenteditable] :where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line:not(.paraflow-list-owned-line):not(.paraflow-list-owned-blank-line):not(.paraflow-list-owned-line--native-depth)
	.cm-hmd-list-indent,
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	> .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content[contenteditable] .paraflow-list-marker-line
	.cm-hmd-list-indent {
	font-family: var(--font-monospace);
	font-size: 0;
	line-height: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	> .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content[contenteditable] .paraflow-list-owned-line
	.cm-hmd-list-indent,
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	> .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content[contenteditable] .paraflow-list-owned-line--native-depth
	.cm-hmd-list-indent {
	font: inherit;
	line-height: inherit;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	> .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content[contenteditable] .paraflow-list-owned-line:not(.paraflow-list-owned-line--native-depth)
	.cm-indent-spacing {
	display: inline;
	padding-inline: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.cm-content[contenteditable] :where(.paraflow-structured-list-active *, .paraflow-callout-line *).cm-hmd-list-indent
	.cm-indent::before {
	content: none;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line:not(.paraflow-code-line, .paraflow-math-source-block) {
	padding-block: var(--paraflow-list-row-padding, .3em);
	line-height: var(--paraflow-list-line-height, var(--paraflow-line-height));
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line--ordered-task {
	--paraflow-live-list-hanging-indent: 2.25em;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-1:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line) {
	--paraflow-native-depth: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-2:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line) {
	--paraflow-native-depth: 1;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-3:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line) {
	--paraflow-native-depth: 2;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-4:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line) {
	--paraflow-native-depth: 3;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-5:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line) {
	--paraflow-native-depth: 4;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-6:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line) {
	--paraflow-native-depth: 5;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).paraflow-list-marker-line:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line) {
	--paraflow-native-depth: var(--paraflow-list-depth);
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-1:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-2:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-3:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-4:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-5:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).HyperMD-list-line-6:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:where(.paraflow-structured-list-active *, .paraflow-callout-line).paraflow-list-marker-line:not(.paraflow-code-line, .paraflow-math-source-block):not(.paraflow-list-owned-line) {
	--paraflow-list-layout-depth: var(--paraflow-native-depth);
	--paraflow-list-layout-hanging: var(--paraflow-live-list-hanging-indent);
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line {
	padding-block: var(--paraflow-list-row-padding, .3em);
	line-height: var(--paraflow-list-line-height, var(--paraflow-line-height));
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	:is(.paraflow-list-marker-line, .paraflow-list-owned-line)[data-paraflow-list-rhythm~="base-continuation-before"] {
	padding-block-end: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-continuation-line:not(.paraflow-list-empty-body-line) {
	padding-block-start: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line:is(.paraflow-list-owned-line--unordered, .paraflow-list-owned-line--ordered, .paraflow-list-owned-line--task):not(.paraflow-list-owned-blank-line):not(.paraflow-list-owned-line--native-depth),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-empty-body-line:is(.paraflow-list-owned-line--unordered, .paraflow-list-owned-line--ordered, .paraflow-list-owned-line--task) {
	--paraflow-list-owned-hanging-indent: var(--paraflow-live-list-hanging-indent);
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-empty-body {
	display: inline;
	width: 0;
	font: inherit;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-1:not(.paraflow-math-source-block) {
	--paraflow-owned-depth: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-2:not(.paraflow-math-source-block) {
	--paraflow-owned-depth: 1;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-3:not(.paraflow-math-source-block) {
	--paraflow-owned-depth: 2;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-4:not(.paraflow-math-source-block) {
	--paraflow-owned-depth: 3;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-5:not(.paraflow-math-source-block) {
	--paraflow-owned-depth: 4;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-6:not(.paraflow-math-source-block) {
	--paraflow-owned-depth: 5;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-1:not(.paraflow-math-source-block),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-2:not(.paraflow-math-source-block),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-3:not(.paraflow-math-source-block),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-4:not(.paraflow-math-source-block),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-5:not(.paraflow-math-source-block),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-line-6:not(.paraflow-math-source-block) {
	--paraflow-list-layout-depth: var(--paraflow-owned-depth);
	--paraflow-list-layout-hanging: var(--paraflow-list-owned-hanging-indent, 0px);
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-owned-blank-line {
	min-height: var(--paraflow-blank-line-height);
	padding-block: 0;
	line-height: var(--paraflow-blank-line-height);
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	> .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content[contenteditable] .paraflow-list-blank-gap-head {
	min-height: var(--paraflow-block-gap);
	line-height: var(--paraflow-block-gap);
	padding-block: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	> .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content[contenteditable] .paraflow-list-blank-gap-head > .cm-widgetBuffer {
	height: 0;
	vertical-align: baseline;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	> .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content[contenteditable] .paraflow-list-blank-editable {
	--paraflow-list-owned-hanging-indent: var(--paraflow-live-list-hanging-indent);
	min-height: calc(1em * var(--paraflow-line-height));
	line-height: var(--paraflow-line-height);
	padding-block: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	> .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content[contenteditable] .paraflow-list-blank-folded {
	height: 0;
	min-height: 0;
	line-height: 0;
	padding-block: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.cm-content:not(.cm-table-widget *) > :is(.paraflow-list-marker-line, .paraflow-list-owned-line)[data-paraflow-list-rhythm~="base-gap-before"],
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.cm-content:not(.cm-table-widget *) > :is(.paraflow-list-marker-line, .paraflow-list-owned-line)[data-paraflow-list-rhythm~="base-blank-before"][data-paraflow-list-rhythm] {
	padding-block-end: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.cm-content:not(.cm-table-widget *) > [data-paraflow-after="list-item"]
	+ :is(.paraflow-list-marker-line, .paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.cm-content:not(.cm-table-widget *) > [data-paraflow-after="list-item"]
	+ :is(.paraflow-paragraph-folded-row, .paraflow-callout-gap-tail)
	+ :is(.paraflow-list-marker-line, .paraflow-list-owned-line),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.cm-content:not(.cm-table-widget *) > :is(.paraflow-list-marker-line, .paraflow-list-owned-line)
	+ .paraflow-list-owned-blank-line
	+ :is(.paraflow-list-marker-line, .paraflow-list-owned-line) {
	padding-block-start: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-structured-list-active
	.list-bullet {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1em;
	color: transparent;
	font: inherit;
	line-height: 1;
	vertical-align: middle;
	margin-inline-end: -0.5em;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-structured-list-active
	.cm-content[contenteditable] .list-bullet::before {
	display: none;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-structured-list-active
	.cm-content[contenteditable] .list-bullet::after {
	content: '';
	position: relative;
	box-sizing: border-box;
	flex: 0 0 auto;
	width: var(--paraflow-marker-size, var(--paraflow-live-marker-size, 0.375em));
	height: var(--paraflow-marker-size, var(--paraflow-live-marker-size, 0.375em));
	aspect-ratio: 1;
	border: var(--paraflow-marker-border, var(--paraflow-live-marker-border, 0));
	border-radius: var(--paraflow-marker-radius, var(--paraflow-live-marker-radius, 0));
	background: var(--paraflow-marker-background, var(--paraflow-live-marker-background, transparent));
	top: 0;
	transform: none;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-structured-list-active
	.cm-content[contenteditable] .HyperMD-list-line:not(.cm-active)[data-paraflow-children~="native-bullet"]
	.cm-formatting-list {
	color: transparent;
	font-size: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-structured-list-active.cm-focused
	.cm-content[contenteditable] .HyperMD-list-line.cm-active
	.cm-formatting-list {
	color: var(--text-normal);
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-structured-list-active
	.HyperMD-list-line.cm-active:not(.HyperMD-task-line)
	.list-bullet {
	display: none;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-structured-list-active
	.HyperMD-list-line-1:not(.HyperMD-task-line)
	.list-bullet::after {
	--paraflow-live-marker-radius: 50%;
	--paraflow-live-marker-background: var(--paraflow-marker-color, var(--text-normal));
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-structured-list-active
	.HyperMD-list-line-2:not(.HyperMD-task-line)
	.list-bullet::after {
	--paraflow-live-marker-size: 0.4375em;
	--paraflow-live-marker-border: 1px solid var(--paraflow-marker-color, var(--text-normal));
	--paraflow-live-marker-radius: 50%;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-structured-list-active
	.HyperMD-list-line-3:not(.HyperMD-task-line)
	.list-bullet::after,
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-structured-list-active
	.HyperMD-list-line-4:not(.HyperMD-task-line)
	.list-bullet::after,
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-structured-list-active
	.HyperMD-list-line-5:not(.HyperMD-task-line)
	.list-bullet::after,
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-structured-list-active
	.HyperMD-list-line-6:not(.HyperMD-task-line)
	.list-bullet::after {
	--paraflow-live-marker-radius: 0;
	--paraflow-live-marker-background: var(--paraflow-marker-color, var(--text-normal));
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	> .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content[contenteditable] .paraflow-list-separator {
	display: inline-block;
	width: calc(2 * var(--paraflow-live-list-content-offset) + var(--paraflow-live-list-hanging-indent) - 1em);
	padding: 0;
	margin: 0;
	font: inherit;
	white-space: pre;
	text-align: end;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.cm-content[contenteditable] .cm-formatting-list[data-paraflow-children~="list-separator"],
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	> .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content[contenteditable] .paraflow-list-separator .cm-formatting-list {
	padding: 0;
	margin: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-marker {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	width: 1em;
	color: var(--text-normal);
	font: inherit;
	line-height: 1;
	vertical-align: middle;
	margin-inline-end: 0;
	-webkit-user-select: none;
	user-select: none;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-marker--unordered:not(.paraflow-list-marker--task) {
	width: 1em;
	height: 1lh;
	line-height: inherit;
	vertical-align: top;
	color: transparent;
	margin-inline-end: calc(0px - var(--paraflow-live-list-content-offset));
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-marker--ordered {
	position: relative;
	vertical-align: baseline;
	inset-inline-start: 0.125em;
	width: 1em;
	justify-content: flex-end;
	white-space: nowrap;
	overflow: visible;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-marker--ordered:not(.paraflow-list-marker--task) {
	margin-inline-end: calc(0px - var(--paraflow-live-list-content-offset));
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-marker--unordered:not(.paraflow-list-marker--task)::after,
.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-callout-active
	.cm-callout .callout-content ul > li:not(.task-list-item)::before {
	content: '';
	position: relative;
	box-sizing: border-box;
	flex: 0 0 auto;
	width: var(--paraflow-marker-size, var(--paraflow-live-marker-size, 0.375em));
	height: var(--paraflow-marker-size, var(--paraflow-live-marker-size, 0.375em));
	aspect-ratio: 1;
	border: var(--paraflow-marker-border, var(--paraflow-live-marker-border, 0));
	border-radius: var(--paraflow-marker-radius, var(--paraflow-live-marker-radius, 0));
	background: var(--paraflow-marker-background, var(--paraflow-live-marker-background, transparent));
	top: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-marker--disc::after,
.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-callout-active
	.cm-callout .callout-content > ul > li:not(.task-list-item)::before {
	--paraflow-live-marker-radius: 50%;
	--paraflow-live-marker-background: var(--paraflow-marker-color, var(--text-normal));
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-marker--ring::after,
.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-callout-active
	.cm-callout .callout-content > :is(ul, ol) > li > ul > li:not(.task-list-item)::before {
	--paraflow-live-marker-size: 0.4375em;
	--paraflow-live-marker-border: 1px solid var(--paraflow-marker-color, var(--text-normal));
	--paraflow-live-marker-radius: 50%;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-marker--square::after,
.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-callout-active
	.cm-callout .callout-content > :is(ul, ol) > li > :is(ul, ol) ul > li:not(.task-list-item)::before {
	--paraflow-live-marker-radius: 0;
	--paraflow-live-marker-background: var(--paraflow-marker-color, var(--text-normal));
}

.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-callout-active
	.cm-callout .callout-content ul > li:not(.task-list-item) {
	position: relative;
	list-style: none;
}

.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-callout-active
	.cm-callout .callout-content ul > li:not(.task-list-item)::before {
	position: absolute;
	inset-inline-start: calc(0px - var(--paraflow-live-list-content-offset) - var(--paraflow-live-list-hanging-indent) + .5em - var(--paraflow-marker-size, var(--paraflow-live-marker-size, .375em)) / 2);
	top: calc(var(--paraflow-list-row-padding, .3em) + .75em - var(--paraflow-marker-size, var(--paraflow-live-marker-size, .375em)) / 2);
}

.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-callout-active
	.cm-callout .callout-content :is(ul, ol)::before {
	display: none;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-list-marker--task.paraflow-list-marker--unordered {
	display: none;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-task-prefix {
	display: inline-flex;
	align-items: center;
	min-width: calc(var(--paraflow-live-list-content-offset) + var(--paraflow-live-list-hanging-indent));
	line-height: inherit;
	vertical-align: middle;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.cm-content[contenteditable] .paraflow-task-checkbox {
	flex: 0 0 auto;
	margin: 0 0.375em 0 0;
	transform: none;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.cm-content[contenteditable] .paraflow-task-marker-separator,
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.cm-content[contenteditable] .paraflow-task-content-separator {
	display: inline-block;
	white-space: pre;
	text-decoration: none;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-task-content-separator {
	flex: 1 0 auto;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.paraflow-task-caret-metric {
	align-self: center;
	display: block;
	flex: 0 0 0;
	overflow: hidden;
	pointer-events: none;
	width: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-task-content-caret-active
	.cm-content[contenteditable] {
	caret-color: transparent;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor
	.paraflow-task-content-caret {
	position: absolute;
	width: 1px;
	background: var(--text-normal);
	pointer-events: none;
	visibility: hidden;
	z-index: 2;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-task-content-caret-active
	.paraflow-task-content-caret {
	visibility: visible;
	animation: paraflow-task-caret-blink 1.2s steps(1) infinite;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
	.HyperMD-task-line.paraflow-task-prefix-line
	.task-list-item-checkbox:not(.paraflow-task-checkbox) {
	display: none;
}

.markdown-source-view.mod-cm6.is-live-preview > .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
 .paraflow-task-prefix--unordered {
 position: relative;
 height: 1lh;
 vertical-align: top;
}

.markdown-source-view.mod-cm6.is-live-preview > .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
 .cm-content[contenteditable] .paraflow-task-prefix--unordered .paraflow-task-checkbox {
 position: absolute;
 inset-inline-start: 0;
 top: calc(50% - var(--checkbox-size, 1em) / 2);
 margin: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
 > .cm-editor:is(.paraflow-structured-list-active, .paraflow-callout-active)
 .cm-content[contenteditable] .paraflow-list-body-separator {
 height: 0;
 min-height: 0;
 line-height: 0;
 padding-block: 0;
}
/* Native and projected rows share the inline padding owner; row tokens retain their geometry. */
${LIST_LAYOUT_ROW_SELECTOR} {
	padding-inline-start: calc(var(--paraflow-container-inset, 0px) + var(--paraflow-live-list-base-indent) + var(--paraflow-list-layout-depth) * var(--paraflow-live-list-indent) + var(--paraflow-live-list-content-offset) + var(--paraflow-list-layout-hanging));
}
`;
