import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export const CODE_SOURCE_PALETTES = ['obsidian', 'one-light', 'solarized', 'light-plus'] as const;
export type CodeSourcePalette = typeof CODE_SOURCE_PALETTES[number];

export function isCodeSourcePalette(value: unknown): value is CodeSourcePalette {
	return typeof value === 'string' && CODE_SOURCE_PALETTES.some(palette => palette === value);
}

// Only token foregrounds change; the content theme retains block geometry and background.
const palettes = {
	'one-light': { plain: '#383a42', comment: '#a0a1a7', keyword: '#a626a4', string: '#50a14f', number: '#986801', function: '#4078f2', type: '#c18401', operator: '#0184bc', punctuation: '#383a42', property: '#e45649' },
	solarized: { plain: '#657b83', comment: '#93a1a1', keyword: '#859900', string: '#2aa198', number: '#d33682', function: '#268bd2', type: '#b58900', operator: '#859900', punctuation: '#657b83', property: '#cb4b16' },
	'light-plus': { plain: '#000000', comment: '#008000', keyword: '#0000ff', string: '#a31515', number: '#098658', function: '#795e26', type: '#267f99', operator: '#000000', punctuation: '#000000', property: '#001080' },
} as const;

export function codeSourcePaletteExtension(palette: CodeSourcePalette): Extension {
	if (palette === 'obsidian') return [];
	const colors = palettes[palette];
	const root = '.paraflow-code-syntax-line .paraflow-code-syntax';
	const token = (types: string) => `${root}.token:is(${types})`;
	return EditorView.theme({
		[root]: { color: `${colors.plain} !important` },
		[token('.comment,.prolog,.doctype,.cdata')]: { color: `${colors.comment} !important` },
		[token('.keyword,.atrule')]: { color: `${colors.keyword} !important` },
		[token('.string,.char,.attr-value,.regex,.inserted')]: { color: `${colors.string} !important` },
		[token('.number,.boolean,.constant')]: { color: `${colors.number} !important` },
		[token('.function,.function-variable')]: { color: `${colors.function} !important` },
		[token('.class-name,.builtin')]: { color: `${colors.type} !important` },
		[token('.operator,.entity,.url')]: { color: `${colors.operator} !important` },
		[token('.punctuation')]: { color: `${colors.punctuation} !important` },
		[token('.property,.attr-name,.tag,.selector,.symbol,.deleted')]: { color: `${colors.property} !important` },
	});
}
