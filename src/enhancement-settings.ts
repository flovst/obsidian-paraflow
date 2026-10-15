import { isMathSourcePalette, type MathSourcePalette } from './themes/math-palette.js';

export type PasteMode = 'exact' | 'smart';

export interface EnhancementSettings {
	mathSourcePalette: MathSourcePalette;
	bodyLayout: boolean;
	callout: boolean;
	footnotes: boolean;
	footnoteHideDefinitionMarkers: boolean;
	commentDisplay: 'always' | 'editing';
	subscript: boolean;
	superscript: boolean;
	images: boolean;
	code: boolean;
	tableDisplay: boolean;
	tableEditing: boolean;
	tableAutoWrap: boolean;
	tableHideAddControls: boolean;
	pasteCloseCodeFences: boolean;
	sourcePasteMode: PasteMode;
	livePreviewPasteMode: PasteMode;
	imageCenter: boolean;
	codeWordWrap: boolean;
	codeLineNumbers: boolean;
	codeLanguagePosition: 'off' | 'top-right' | 'bottom-right';
	paragraphIndent: boolean;
	bodyTabMode: 'fixed' | 'tab-stops';
	bodyTabSize: number;
	paragraphSpacingEm: number | null;
	maintainListIndentOnSave: boolean;
	maintainListIndentOnModeChange: boolean;
	sourceView: boolean;
	sourceActiveLine: boolean;
	sourceWhitespace: boolean;
	sourceIndentGuides: boolean;
	sourceLineNumbers: boolean;
	sourceLineNumberStyle: 'full' | 'compact';
	sourceLineNumberPosition: 'editor-left' | 'body-left';
	sourceNewlineMarkers: boolean;
	sourceTabSize: number;
	mergeWarning: boolean;
}

export type EnhancementToggle = Exclude<keyof EnhancementSettings, 'bodyTabMode' | 'bodyTabSize' | 'sourceTabSize' | 'sourceLineNumberStyle' | 'sourceLineNumberPosition' | 'paragraphSpacingEm' | 'commentDisplay' | 'codeLanguagePosition' | 'mathSourcePalette' | 'sourcePasteMode' | 'livePreviewPasteMode'>;

export const DEFAULT_ENHANCEMENTS: Readonly<EnhancementSettings> = Object.freeze({
	mathSourcePalette: 'one-light',
	bodyLayout: true,
	callout: true,
	footnotes: true,
	footnoteHideDefinitionMarkers: true,
	commentDisplay: 'always',
	subscript: true,
	superscript: true,
	images: true,
	code: true,
	tableDisplay: true,
	tableEditing: true,
	tableAutoWrap: true,
	tableHideAddControls: true,
	pasteCloseCodeFences: true,
	sourcePasteMode: 'exact',
	livePreviewPasteMode: 'smart',
	imageCenter: true,
	codeWordWrap: false,
	codeLineNumbers: true,
	codeLanguagePosition: 'bottom-right',
	paragraphIndent: false,
	bodyTabMode: 'fixed',
	bodyTabSize: 8,
	paragraphSpacingEm: null,
	maintainListIndentOnSave: true,
	maintainListIndentOnModeChange: false,
	sourceView: true,
	sourceActiveLine: true,
	sourceWhitespace: true,
	sourceIndentGuides: false,
	sourceLineNumbers: true,
	sourceLineNumberStyle: 'compact',
	sourceLineNumberPosition: 'body-left',
	sourceNewlineMarkers: false,
	sourceTabSize: 4,
	mergeWarning: true,
});

export function normalizeEnhancements(value: unknown): EnhancementSettings {
	const settings = { ...DEFAULT_ENHANCEMENTS };
	if (!value || typeof value !== 'object' || Array.isArray(value)) return settings;
	for (const key of Object.keys(settings) as Array<keyof EnhancementSettings>) {
		const candidate: unknown = Reflect.get(value, key);
		if (key === 'bodyTabMode') {
			if (candidate === 'fixed' || candidate === 'tab-stops') settings[key] = candidate;
		} else if (key === 'bodyTabSize') {
			if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 1 && candidate <= 32) settings[key] = candidate;
		} else if (key === 'sourceTabSize') {
			if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 1 && candidate <= 8) settings[key] = candidate;
		} else if (key === 'sourceLineNumberStyle') {
			if (candidate === 'full' || candidate === 'compact') settings[key] = candidate;
		} else if (key === 'sourceLineNumberPosition') {
			if (candidate === 'editor-left' || candidate === 'body-left') settings[key] = candidate;
		} else if (key === 'sourcePasteMode' || key === 'livePreviewPasteMode') {
			if (candidate === 'exact' || candidate === 'smart') settings[key] = candidate;
		} else if (key === 'mathSourcePalette') {
			if (isMathSourcePalette(candidate)) settings[key] = candidate;
		} else if (key === 'commentDisplay') {
			if (candidate === 'always' || candidate === 'editing') settings[key] = candidate;
		} else if (key === 'codeLanguagePosition') {
			if (candidate === 'off' || candidate === 'top-right' || candidate === 'bottom-right') settings[key] = candidate;
		} else if (key === 'paragraphSpacingEm') {
			if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 && candidate <= 10) settings[key] = candidate;
		} else if (typeof candidate === 'boolean') settings[key] = candidate;
	}
	return settings;
}
