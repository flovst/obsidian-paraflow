import type { ThemeManifest, ThemeSourceMetadata } from '../themes/model.js';
import { bundledThemeMetadata } from '../themes/builtin.js';
import { supportsThemeColorScheme } from '../themes/appearance.js';
import { translate as t } from './i18n.js';

export const themeLibraryColumns = ['libraryName', 'libraryScheme', 'libraryPackage', 'librarySource', 'themeOrigin'] as const;
export type ThemeLibraryColumn = typeof themeLibraryColumns[number];
export interface ThemeLibraryEntry {
	key: string;
	packageId?: string;
	themes: readonly ThemeManifest[];
}
export function themeSource(theme: ThemeManifest): ThemeSourceMetadata { return { ...bundledThemeMetadata(theme.id), ...theme }; }
export const themeInstallation = (theme: ThemeManifest): ThemeManifest['origin'] => bundledThemeMetadata(theme.id) ? 'builtin' : theme.origin;
export const themeScheme = (theme: ThemeManifest): 'light' | 'dark' | 'adaptive' | undefined => supportsThemeColorScheme(theme) ? 'adaptive' : theme.colorScheme === 'adaptive' ? undefined : theme.colorScheme;
export function packageName(entry: ThemeLibraryEntry): string { return entry.themes.map(theme => themeSource(theme).sourcePackage).find(Boolean) || entry.packageId!; }
export function themeCell(theme: ThemeManifest, column: ThemeLibraryColumn): string {
	switch (column) {
		case 'libraryName': return theme.name;
		case 'libraryScheme': { const value = themeScheme(theme); return value ? t(value === 'adaptive' ? 'libraryAdaptive' : value) : '-'; }
		case 'libraryPackage': return themeSource(theme).sourcePackage || '-';
		case 'librarySource': return themeSource(theme).sourceApp || '-';
		case 'themeOrigin': return t(themeInstallation(theme) === 'builtin' ? 'builtInTheme' : 'importedTheme');
	}
}
export function entryCell(entry: ThemeLibraryEntry, column: ThemeLibraryColumn): string {
	if (!entry.packageId) return themeCell(entry.themes[0]!, column);
	if (column === 'libraryName' || column === 'libraryPackage') return packageName(entry);
	if (column === 'libraryScheme') {
		const values = new Set(entry.themes.map(themeScheme));
		if (values.has(undefined)) return '-';
		return t(values.has('adaptive') || values.size > 1 ? 'libraryAdaptive' : values.has('dark') ? 'dark' : 'light');
	}
	const values = new Set(entry.themes.map(theme => themeCell(theme, column)));
	return values.size === 1 ? [...values][0]! : '-';
}
/** Package identity is explicit; attribution labels alone never merge imported themes. */
export function themeEntries(themes: readonly ThemeManifest[]): ThemeLibraryEntry[] {
	const packages = new Map<string, ThemeLibraryEntry>();
	const result: ThemeLibraryEntry[] = [];
	for (const theme of [...themes].sort((a, b) => a.id.localeCompare(b.id))) {
		const packageId = themeSource(theme).packageId;
		if (!packageId) { result.push({ key: `theme:${theme.id}`, themes: [theme] }); continue; }
		let entry = packages.get(packageId);
		if (!entry) { entry = { key: `package:${packageId}`, packageId, themes: [] }; packages.set(packageId, entry); result.push(entry); }
		entry.themes = [...entry.themes, theme];
	}
	return result;
}
