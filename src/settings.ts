import { normalizeThemeOverrides, type ThemeOverrides } from './themes/appearance.js';
import { DEFAULT_ENHANCEMENTS, OTHER_ENHANCEMENTS, normalizeEnhancements, type EnhancementSettings } from './enhancement-settings.js';

export interface ParaFlowSettings {
	enhancements: EnhancementSettings;
	contentThemeId: string | null;
	themeOverrides: Record<string, ThemeOverrides>;
	metadataGap: number | null;
	disableSelectedTextDrag: boolean;
	hideCaretWhileDragSelecting: boolean;
	editLinksOnPlainClick: boolean;
	breakMarkersEnabled: boolean;
	htmlBreakMarkersEnabled: boolean;
	hardBreakMarkersEnabled: boolean;
	paragraphEditingEnabled: boolean;
	structuredListEditingEnabled: boolean;
}

export const DEFAULT_SETTINGS: ParaFlowSettings = Object.freeze({
	enhancements: DEFAULT_ENHANCEMENTS,
	contentThemeId: null,
	themeOverrides: {},
	metadataGap: -6,
	disableSelectedTextDrag: true,
	hideCaretWhileDragSelecting: true,
	editLinksOnPlainClick: true,
	breakMarkersEnabled: true,
	htmlBreakMarkersEnabled: true,
	hardBreakMarkersEnabled: true,
	paragraphEditingEnabled: true,
	structuredListEditingEnabled: true,
});

export type SourceMaintenanceMode = 'never' | 'save' | 'mode-change' | 'both';

export function resetEditingSettings(current: ParaFlowSettings): ParaFlowSettings {
	const themeOverrides = Object.fromEntries(Object.entries(current.themeOverrides).map(([id, overrides]) => {
		const next = { ...overrides };
		delete next.marker;
		return [id, next];
	}));
	const enhancements = { ...DEFAULT_ENHANCEMENTS };
	for (const key of OTHER_ENHANCEMENTS) enhancements[key] = current.enhancements[key];
	return { ...DEFAULT_SETTINGS, enhancements, contentThemeId: current.contentThemeId, themeOverrides, metadataGap: current.metadataGap };
}

export function normalizeMetadataGap(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(-150, Math.min(200, value)) : -6;
}

export function normalizeSettings(value: unknown): ParaFlowSettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { ...DEFAULT_SETTINGS, enhancements: { ...DEFAULT_ENHANCEMENTS } };
	}
	// Persisted configs retain historical editor defaults; newly added modules use delivery defaults.
	const paragraphEnabled = 'paragraphEditingEnabled' in value
		? value.paragraphEditingEnabled
		: undefined;
	const structuredListEnabled = 'structuredListEditingEnabled' in value
		? value.structuredListEditingEnabled
		: undefined;
	const lineBreakMarkersEnabled = 'lineBreakMarkersEnabled' in value
		? value.lineBreakMarkersEnabled
		: undefined;
	const htmlBreakMarkersEnabled = 'htmlBreakMarkersEnabled' in value ? value.htmlBreakMarkersEnabled : undefined;
	const editLinksOnPlainClick = 'editLinksOnPlainClick' in value
		? value.editLinksOnPlainClick
		: undefined;
	const disableSelectedTextDrag = 'disableSelectedTextDrag' in value
		? value.disableSelectedTextDrag
		: undefined;
	const hideCaretWhileDragSelecting = 'hideCaretWhileDragSelecting' in value ? value.hideCaretWhileDragSelecting : undefined;
	const storedEnhancements = 'enhancements' in value && value.enhancements && typeof value.enhancements === 'object' ? value.enhancements : {};
	const enhancements = normalizeEnhancements(storedEnhancements);
	const contentThemeId = !('contentThemeId' in value) ? 'builtin-classic'
		: typeof value.contentThemeId === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value.contentThemeId) ? value.contentThemeId : null;
	const storedOverrides = 'themeOverrides' in value && value.themeOverrides && typeof value.themeOverrides === 'object' && !Array.isArray(value.themeOverrides)
		? value.themeOverrides as Record<string, unknown> : {};
	const activeOverrides = storedOverrides[contentThemeId ?? 'paraflow-follow'];
	const legacyGap = activeOverrides && typeof activeOverrides === 'object' && 'metadataGap' in activeOverrides ? activeOverrides.metadataGap : null;
	for (const key of ['headings', 'htmlBlocks'] as const) {
		if (!(key in storedEnhancements)) enhancements[key] = typeof paragraphEnabled === 'boolean' ? paragraphEnabled : false;
	}
	return {
		enhancements: { ...enhancements, bodyLayout: typeof paragraphEnabled === 'boolean' ? paragraphEnabled : false },
		metadataGap: normalizeMetadataGap('metadataGap' in value ? value.metadataGap : legacyGap),
		themeOverrides: Object.fromEntries(Object.entries(storedOverrides)
			.filter(([id]) => /^[a-z0-9][a-z0-9-]{0,79}$/u.test(id))
			.map(([id, overrides]) => [id, normalizeThemeOverrides(overrides)])),
		contentThemeId,
		hideCaretWhileDragSelecting: typeof hideCaretWhileDragSelecting === 'boolean'
			? hideCaretWhileDragSelecting : DEFAULT_SETTINGS.hideCaretWhileDragSelecting,
		disableSelectedTextDrag: typeof disableSelectedTextDrag === 'boolean'
			? disableSelectedTextDrag
			: DEFAULT_SETTINGS.disableSelectedTextDrag,
		editLinksOnPlainClick: typeof editLinksOnPlainClick === 'boolean'
			? editLinksOnPlainClick
			: DEFAULT_SETTINGS.editLinksOnPlainClick,
		breakMarkersEnabled: typeof paragraphEnabled === 'boolean' ? paragraphEnabled : false,
		htmlBreakMarkersEnabled: typeof htmlBreakMarkersEnabled === 'boolean' ? htmlBreakMarkersEnabled
			: typeof lineBreakMarkersEnabled === 'boolean' ? lineBreakMarkersEnabled : DEFAULT_SETTINGS.htmlBreakMarkersEnabled,
		hardBreakMarkersEnabled: true,
		paragraphEditingEnabled: typeof paragraphEnabled === 'boolean'
			? paragraphEnabled
			: false,
		structuredListEditingEnabled: typeof structuredListEnabled === 'boolean'
			? structuredListEnabled
			: false,
	};
}
