export const READING_BLANK_PARAGRAPH_CSS = `
.markdown-reading-view .paraflow-reading-blank-paragraphs,.markdown-reading-view .paraflow-reading-blank-paragraphs>[data-paraflow-blank-row]{
 display:block;margin:0;padding:0;border:0;
}
.paraflow-reading-blank-paragraphs{pointer-events:none;font-size:var(--font-text-size,16px)}
.paraflow-reading-blank-paragraphs>[data-paraflow-blank-row]{height:var(--paraflow-reading-blank-height);min-height:var(--paraflow-reading-blank-height)}
`;
