export interface ParaFlowSettings {
	structuredListEditingEnabled: boolean;
}

export const DEFAULT_SETTINGS: ParaFlowSettings = Object.freeze({
	structuredListEditingEnabled: false,
});

export function normalizeSettings(value: unknown): ParaFlowSettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { ...DEFAULT_SETTINGS };
	}
	const enabled = 'structuredListEditingEnabled' in value
		? value.structuredListEditingEnabled
		: undefined;
	return {
		structuredListEditingEnabled: typeof enabled === 'boolean'
			? enabled
			: DEFAULT_SETTINGS.structuredListEditingEnabled,
	};
}
