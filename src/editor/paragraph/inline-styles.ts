/** Source-backed inline projection owns labels, exposed markers and native-token reset. */
export const INLINE_PROJECTION_CSS = `
.paraflow-inline-body--link,
.paraflow-inline-body--wikilink {
	text-decoration: underline;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor
	.paraflow-line-break-marker {
	margin-inline-start: 0.2em;
	color: var(--paraflow-source-color, var(--text-faint));
	font-size: 1em;
	font-weight: 400;
	line-height: 1;
	-webkit-user-select: none;
	user-select: none;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor .cm-content[contenteditable] .cm-line
	.paraflow-html-break-hint,
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor .cm-content[contenteditable] .cm-line
	.paraflow-html-break-hint * {
	font-family: var(--font-text);
	font-size: 1em;
	font-style: normal;
	font-weight: 400;
	line-height: inherit;
	vertical-align: baseline;
	margin: 0;
	padding: 0;
	border: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor
	.paraflow-html-break-hint,
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor
	.paraflow-html-break-hint *,
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line
	.paraflow-inline-source-active,
.markdown-source-view.mod-cm6.is-live-preview
	.cm-table-widget .cm-content[contenteditable] .cm-line .cm-formatting:is(.cm-formatting-code, .cm-formatting-strong, .cm-formatting-em, .cm-formatting-strikethrough, .cm-formatting-highlight, .cm-formatting-link, .cm-formatting-link-string),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line
	.paraflow-inline-source-active * {
	color: var(--paraflow-source-color, var(--text-faint));
}

.markdown-source-view.mod-cm6.is-live-preview .paraflow-inline-body--strikethrough {
	text-decoration: line-through;
}

:is(.paraflow-inline-body--link, .paraflow-inline-body--wikilink) .cm-underline,
:is(.paraflow-inline-owner--link, .paraflow-inline-owner--wikilink) .cm-underline,
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line
	.paraflow-inline-source-active .cm-url,
.markdown-source-view.mod-cm6.is-live-preview
	.paraflow-inline-source-active--strikethrough .cm-formatting-strikethrough.cm-strikethrough,
.markdown-source-view.mod-cm6.is-live-preview .paraflow-invalid-native-strike,
.markdown-source-view.mod-cm6.is-live-preview .paraflow-invalid-native-strike .cm-strikethrough {
	text-decoration: none;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line
	.paraflow-inline-source-active,
.markdown-source-view.mod-cm6.is-live-preview
	.cm-table-widget .cm-content[contenteditable] .cm-line .cm-formatting:is(.cm-formatting-code, .cm-formatting-strong, .cm-formatting-em, .cm-formatting-strikethrough, .cm-formatting-highlight, .cm-formatting-link, .cm-formatting-link-string),
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line
	.paraflow-inline-source-active * {

	font-family: var(--font-text);
	font-size: 1em;
	font-style: normal;
	font-weight: 400;
	line-height: inherit;
	text-decoration: none;
	border: 0;
	border-radius: 0;
	padding: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line
	:is(.paraflow-inline-owner--highlight, .paraflow-inline-source-active) .cm-highlight,
.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line
	:is(.paraflow-inline-owner--inline-code, .paraflow-inline-source-active) .cm-inline-code {
	border: 0;
	border-radius: 0;
	box-shadow: none;
	padding: 0;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line
	:is(.paraflow-inline-owner--inline-code, .paraflow-inline-source-active) .cm-inline-code {
	font-family: inherit;
	font-size: 1em;
	line-height: inherit;
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active
	.paraflow-inline-body--highlight {
	background: var(--paraflow-highlight-background, var(--highlight-background, var(--text-highlight-bg)));
	color: var(--paraflow-highlight-color, inherit);
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active
	.paraflow-inline-body--inline-code {
	color: var(--paraflow-inline-code-color, var(--code-normal));
	background: var(--paraflow-inline-code-background, var(--paraflow-code-background, var(--code-background)));
	border: var(--paraflow-inline-code-border, 1px solid var(--paraflow-border-color, var(--background-modifier-border)));
	border-radius: var(--paraflow-inline-code-radius, 3px);
	padding: var(--paraflow-inline-code-padding, 0 0.2em);
	font-family: var(--paraflow-inline-code-font, var(--font-monospace));
	font-size: var(--paraflow-inline-code-size, 0.9em);
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active
	.paraflow-inline-body--strong {
	font-weight: var(--paraflow-strong-weight, var(--paraflow-default-strong-weight, var(--bold-weight, 700)));
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active
	.paraflow-inline-body--emphasis {
	font-style: var(--paraflow-emphasis-style, italic);
}

.markdown-source-view.mod-cm6.is-live-preview
	> .cm-editor.paraflow-inline-active
	.paraflow-inline-body--strong-emphasis {
	font-style: var(--paraflow-emphasis-style, italic);
	font-weight: var(--paraflow-strong-weight, var(--paraflow-default-strong-weight, var(--bold-weight, 700)));
}

.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line :is(.paraflow-literal-inline-marker,.paraflow-literal-inline-marker :is(.cm-inline-code,.cm-highlight)) {
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  font-style: inherit;
  font-weight: inherit;
  line-height: inherit;
  text-decoration: none;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  padding: 0;
}

.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line :is(.paraflow-literal-reference, .paraflow-literal-reference .cm-link) {
	color: inherit;
	text-decoration: none;
	cursor: text;
}

.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line .paraflow-inline-source-active,
.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line .paraflow-inline-source-active *,
.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line :is(.paraflow-literal-inline-marker,.paraflow-literal-inline-marker :is(.cm-inline-code,.cm-highlight)),
.markdown-source-view.mod-cm6.is-live-preview .cm-table-widget .cm-content[contenteditable] .cm-line .cm-formatting:is(.cm-formatting-code, .cm-formatting-strong, .cm-formatting-em, .cm-formatting-strikethrough, .cm-formatting-highlight, .cm-formatting-link, .cm-formatting-link-string),
.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line :is(.paraflow-inline-owner--highlight, .paraflow-inline-source-active) .cm-highlight,
.markdown-source-view.mod-cm6.is-live-preview > .cm-editor.paraflow-inline-active .cm-content[contenteditable] .cm-line :is(.paraflow-inline-owner--inline-code, .paraflow-inline-source-active) .cm-inline-code {
	background: transparent;
}
`;
