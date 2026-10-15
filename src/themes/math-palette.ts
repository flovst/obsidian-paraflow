import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export const MATH_SOURCE_PALETTES = {
	'one-light': 'One Light 精简（A）',
	solarized: 'Solarized 青绿（B）',
	'light-plus': 'Light+ 清晰蓝（C）',
	obsidian: '跟随 Obsidian 主题色',
	typora: 'Typora',
} as const;

export type MathSourcePalette = keyof typeof MATH_SOURCE_PALETTES;
export function isMathSourcePalette(value: unknown): value is MathSourcePalette {
	return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MATH_SOURCE_PALETTES, value);
}

const palettes: Record<MathSourcePalette, readonly [string, string, string, string]> = {
	'one-light': ['#383a42', '#4078f2', '#777c88', '#383a42'],
	solarized: ['#657b83', '#2aa198', '#839496', '#657b83'],
	'light-plus': ['#000000', '#0000ff', '#777777', '#000000'],
	obsidian: ['var(--text-normal)', 'var(--text-accent)', 'var(--text-muted)', 'var(--text-normal)'],
	// Solid glyph interiors sampled from the supplied Typora math-source screenshot.
	typora: ['#333333', '#117700', '#999999', '#333333'],
};

export function mathSourcePaletteExtension(palette: MathSourcePalette): Extension {
	const [body, command, punctuation, number] = palettes[palette];
	return EditorView.theme({ '&': {
		'--paraflow-math-body-color': body,
		'--paraflow-math-command-color': command,
		'--paraflow-math-punctuation-color': punctuation,
		'--paraflow-math-number-color': number,
	} });
}
