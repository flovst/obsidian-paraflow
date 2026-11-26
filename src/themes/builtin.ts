import type { ThemeManifest, ThemePackageManifest, ThemeSourceMetadata } from './model.js';
import type { ThemeStore } from './store.js';
import { readPackagedTheme, readThemePackage } from './packaged-theme.js';
import { resolveThemeUrls } from './runtime-css.js';
import catalogue from '../../themes/bundled.json';
import { bundleRevision, readBundleState, updateBundledTheme } from './bundled-update.js';

export interface BundledThemeEntry {
 manifest: ThemeManifest | ThemePackageManifest;
 themes: ThemeManifest[];
 files: Array<[string, string]>;
 revision?: string;
}
declare const __PARAFLOW_CLASSIC_CSS__: string;
declare const __PARAFLOW_BUNDLED_THEMES__: BundledThemeEntry[];
export const classicManifest: ThemeManifest = {
 schemaVersion: 1, id: 'builtin-classic', name: 'ParaFlow Classic', origin: 'builtin', colorScheme: 'adaptive',
 sourceApp: 'ParaFlow', sourcePackage: 'ParaFlow bundled themes',
};
export function classicCss(): string { return __PARAFLOW_CLASSIC_CSS__; }

const provenance = new Map(catalogue.flatMap(entry => entry.themeIds.map(id => [id, {
 sourceApp: entry.sourceApp, sourcePackage: entry.sourcePackage, packageId: entry.packageId,
}] as const)));
export function bundledThemeMetadata(id: string): ThemeSourceMetadata | undefined {
 if (id === 'builtin-classic') return { sourceApp: classicManifest.sourceApp, sourcePackage: classicManifest.sourcePackage };
 return provenance.get(id);
}

export async function installBundledThemes(store: ThemeStore): Promise<void> {
 const listing = await store.list();
 await store.ensureBuiltin(classicManifest, classicCss());
 const installed = new Set(['builtin-classic', ...listing.themes.map(theme => theme.id)]);
 for (const bundle of __PARAFLOW_BUNDLED_THEMES__) {
  const missing = bundle.themes.filter(theme => !installed.has(theme.id));
  const revision = bundle.revision ?? await bundleRevision(bundle.files);
  const states = new Map(await Promise.all(bundle.themes.map(async theme => [theme.id, await readBundleState(store, theme.id)] as const)));
  if (!missing.length && bundle.themes.every(theme => states.get(theme.id)?.revision === revision)) continue;
  const files = new Map(bundle.files.map(([path, base64]) => [path, Uint8Array.from(atob(base64), character => character.charCodeAt(0))]));
  if (missing.length && 'type' in bundle.manifest && bundle.manifest.type === 'package') {
   if (missing.length === bundle.themes.length && !await store.storage.exists(store.root + '/' + bundle.manifest.id)) {
    await store.installPackage(files);
   } else {
    // Keep existing user directories; only add missing members on upgrade.
    for (const [index, theme] of readThemePackage(files).themes.entries()) if (!installed.has(theme.manifest.id)) {
     const path = bundle.manifest.themes[index]! + '/overrides.css';
     const overrides = files.has(path) ? new TextDecoder().decode(files.get(path)) : '';
     await store.install(theme, resolveThemeUrls(overrides, String, true));
    }
   }
  } else if (missing.length) {
   const theme = readPackagedTheme(files);
   const sources = new Map(theme.sources);
   for (const [path, bytes] of files) if (!path.includes('/') && /notice|license/iu.test(path)) sources.set(path, bytes);
   await store.install({ ...theme, sources }, files.has('overrides.css') ? new TextDecoder().decode(files.get('overrides.css')) : '');
  }
  for (const theme of missing) installed.add(theme.id);
  await store.list();
  const packaged = 'type' in bundle.manifest && bundle.manifest.type === 'package' ? readThemePackage(files).themes : [readPackagedTheme(files)];
  for (const [index, theme] of packaged.entries()) {
   if (states.get(theme.manifest.id)?.revision === revision) continue;
   const prefix = 'type' in bundle.manifest && bundle.manifest.type === 'package' ? bundle.manifest.themes[index]! + '/' : '';
   const bytes = files.get(prefix + 'overrides.css');
   const overrides = bytes ? new TextDecoder().decode(bytes) : '';
   await updateBundledTheme(store, theme, prefix ? resolveThemeUrls(overrides, String, true) : overrides, revision, states.get(theme.manifest.id) ?? null);
  }
 }
}
