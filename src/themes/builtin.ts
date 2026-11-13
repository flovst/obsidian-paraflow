import type { ConvertedTheme, ThemeManifest, ThemeSourceMetadata } from './model.js';
import type { ThemeStore } from './store.js';

declare const __PARAFLOW_CLASSIC_CSS__: string;
declare const __PARAFLOW_BUNDLED_THEMES__: Array<{
	manifest: ThemeManifest;
	css: string;
	overrides: string;
	assets: Array<[string, string]>;
	sources: Array<[string, string]>;
	diagnostics: ConvertedTheme['diagnostics'];
}>;
export const classicManifest: ThemeManifest = {
	schemaVersion: 1, id: 'builtin-classic', name: 'ParaFlow Classic', origin: 'builtin', colorScheme: 'adaptive',
	sourceApp: 'ParaFlow', sourcePackage: 'ParaFlow bundled themes',
};
export function classicCss(): string { return __PARAFLOW_CLASSIC_CSS__; }

/** Known bundled provenance for packages installed before source metadata was added. */
export function bundledThemeMetadata(id: string): ThemeSourceMetadata | undefined {
	if (id === 'builtin-classic') return { sourceApp: classicManifest.sourceApp, sourcePackage: classicManifest.sourcePackage };
	if (['typora-github', 'typora-night', 'typora-newsprint', 'typora-pixyll', 'typora-whitey'].includes(id)) {
		return { sourceApp: 'Typora', sourcePackage: 'Typora default themes', packageId: 'typora-default' };
	}
	return undefined;
}

export async function installBundledThemes(store: ThemeStore): Promise<void> {
	await store.ensureBuiltin(classicManifest, classicCss());
	for (const bundle of __PARAFLOW_BUNDLED_THEMES__) {
		// Imported packages belong to the user after the first installation.
		if (await store.storage.exists(store.path(bundle.manifest.id))) continue;
		const decode = (files: Array<[string, string]>): Map<string, Uint8Array> => new Map(files.map(([name, base64]) =>
			[name, Uint8Array.from(atob(base64), character => character.charCodeAt(0))]));
		await store.install({ ...bundle, assets: decode(bundle.assets), sources: decode(bundle.sources) }, bundle.overrides);
	}
}
