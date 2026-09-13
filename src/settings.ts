export interface ParaFlowSettings {
	lineBreakMarkersEnabled: boolean;
	paragraphEditingEnabled: boolean;
	structuredListEditingEnabled: boolean;
}

export const DEFAULT_SETTINGS: ParaFlowSettings = Object.freeze({
	lineBreakMarkersEnabled: true,
	paragraphEditingEnabled: false,
	structuredListEditingEnabled: false,
});

export function normalizeSettings(value: unknown): ParaFlowSettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { ...DEFAULT_SETTINGS };
	}
	const paragraphEnabled = 'paragraphEditingEnabled' in value
		? value.paragraphEditingEnabled
		: undefined;
	const structuredListEnabled = 'structuredListEditingEnabled' in value
		? value.structuredListEditingEnabled
		: undefined;
	const lineBreakMarkersEnabled = 'lineBreakMarkersEnabled' in value
		? value.lineBreakMarkersEnabled
		: undefined;
	return {
		lineBreakMarkersEnabled: typeof lineBreakMarkersEnabled === 'boolean'
			? lineBreakMarkersEnabled
			: DEFAULT_SETTINGS.lineBreakMarkersEnabled,
		paragraphEditingEnabled: typeof paragraphEnabled === 'boolean'
			? paragraphEnabled
			: DEFAULT_SETTINGS.paragraphEditingEnabled,
		structuredListEditingEnabled: typeof structuredListEnabled === 'boolean'
			? structuredListEnabled
			: DEFAULT_SETTINGS.structuredListEditingEnabled,
	};
}
