import { EditorView } from '@codemirror/view';

// CodeMirror's low-specificity base theme survives removal of optional CSS.
// The plugin stylesheet and imported theme tokens can still override decoration.
export const structuredListBaseTheme = EditorView.baseTheme({
	'&.paraflow-structured-list-active .paraflow-list-marker': {
		display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
		width: '1em', lineHeight: '1', userSelect: 'none',
		color: 'var(--paraflow-marker-color, var(--text-normal, currentColor))',
	},
	'&.paraflow-structured-list-active .paraflow-list-marker--unordered::after': {
		content: '""', display: 'block', boxSizing: 'border-box',
		width: 'var(--paraflow-marker-size, 0.375em)', height: 'var(--paraflow-marker-size, 0.375em)',
		borderRadius: 'var(--paraflow-marker-radius, 50%)',
		background: 'var(--paraflow-marker-background, var(--paraflow-marker-color, var(--text-normal, currentColor)))',
		border: 'var(--paraflow-marker-border, 0)',
	},
	'&.paraflow-structured-list-active .paraflow-list-marker--ring::after': {
		width: 'var(--paraflow-marker-size, 0.4375em)', height: 'var(--paraflow-marker-size, 0.4375em)',
		background: 'var(--paraflow-marker-background, transparent)',
		border: 'var(--paraflow-marker-border, 1px solid var(--paraflow-marker-color, var(--text-normal, currentColor)))',
	},
	'&.paraflow-structured-list-active .paraflow-list-marker--square::after': {
		borderRadius: 'var(--paraflow-marker-radius, 0)',
	},
	'&.paraflow-structured-list-active .paraflow-list-marker--task.paraflow-list-marker--unordered': { display: 'none' },
});
