export const SHORTHAND_CSS = `
.paraflow-inline-body--subscript, .paraflow-inline-body--superscript,
.paraflow-shorthand-reading, .paraflow-tilde-reading > sub { font-size: .75em; line-height: 0; position: relative; vertical-align: baseline; }
.paraflow-inline-body--subscript, sub.paraflow-shorthand-reading, .paraflow-tilde-reading > sub { bottom: -.25em; }
.paraflow-inline-body--superscript, sup.paraflow-shorthand-reading { top: -.5em; }
.cm-s-obsidian .paraflow-shorthand-blockid-conflict .cm-blockid { font-size: inherit; vertical-align: baseline; top: auto; position: static; color: inherit; }
`;
