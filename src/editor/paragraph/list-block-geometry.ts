/** Resolve configurable font-relative lengths once at the body, before code changes font size. */
export const LIST_BLOCK_GEOMETRY_CSS = `
@property --paraflow-body-list-base { syntax: "<length>"; inherits: true; initial-value: 0px; }
@property --paraflow-body-list-offset { syntax: "<length>"; inherits: true; initial-value: 0px; }
@property --paraflow-body-list-step { syntax: "<length>"; inherits: true; initial-value: 0px; }
.cm-content {
 --paraflow-body-list-base: var(--paraflow-live-list-base-indent, .5em);
 --paraflow-body-list-offset: var(--paraflow-live-list-content-offset, .75em);
 --paraflow-body-list-step: var(--paraflow-live-list-indent, 30px);
}
`;

/** Block borders align with the list body's column, including its invisible marker slot. */
export function listBlockInset(depth: number, task = false, orderedTask = false): string {
	if (!depth) return '0px';
	const base = 'var(--paraflow-body-list-base, calc(.5 * var(--font-text-size, 1rem)))';
	const offset = 'var(--paraflow-body-list-offset, calc(.75 * var(--font-text-size, 1rem)))';
	const hanging = task ? `calc(${orderedTask ? 2.25 : 1.25} * var(--font-text-size, 1rem))` : 'calc(.625 * var(--font-text-size, 1rem))';
	return `calc(${base} + ${depth - 1} * var(--paraflow-body-list-step, 30px) + ${offset} + ${hanging})`;
}
