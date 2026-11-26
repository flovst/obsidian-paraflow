import type { ConvertedTheme } from './model.js';
import type { ThemeStore } from './store.js';
import history from '../../themes/bundled-history.json';
import { resolveThemeUrls } from './runtime-css.js';

interface BundleState {
 schemaVersion: 1;
 revision: string;
 files: Record<string, string>;
 overrides: string;
}
const legacy = history as Record<string, { css: string[]; overrides: string[] }>;
const encoder = new TextEncoder();

// Fingerprints avoid shipping complete historical stylesheets in main.js.
async function fingerprint(bytes: Uint8Array): Promise<string> {
 const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
 return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
const textBytes = (text: string) => encoder.encode(text.replace(/\r\n/gu, '\n'));
const styleBytes = (text: string) => textBytes(resolveThemeUrls(text, String, true));

export async function readBundleState(store: ThemeStore, id: string): Promise<BundleState | null> {
 const path = store.path(id) + '/.bundled-state.json';
 if (!await store.storage.exists(path)) return null;
 const state = JSON.parse(await store.storage.read(path)) as BundleState;
 if (state.schemaVersion !== 1 || typeof state.revision !== 'string' || typeof state.overrides !== 'string'
  || !state.files || typeof state.files !== 'object' || Array.isArray(state.files)
  || !Object.values(state.files).every(value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value))) {
  throw new Error(`Invalid bundled theme state: ${id}`);
 }
 return state;
}

async function mkdir(store: ThemeStore, path: string): Promise<void> {
 if (await store.storage.exists(path)) return;
 const parent = path.slice(0, path.lastIndexOf('/'));
 if (parent) await mkdir(store, parent);
 await store.storage.mkdir(path);
}

export async function bundleRevision(files: readonly [string, string][]): Promise<string> {
 return fingerprint(encoder.encode(JSON.stringify(files)));
}

/** Refresh vendor-owned files while retaining local edits and source metadata. */
export async function updateBundledTheme(store: ThemeStore, theme: ConvertedTheme, overrides: string,
 revision: string, previous: BundleState | null): Promise<void> {
 const id = theme.manifest.id;
 const directory = store.path(id);
 const old = await store.read(id);
 const known = legacy[id];
 const files: Record<string, string> = {};
 const currentCss = await fingerprint(styleBytes(old.css));
 const nextCss = await fingerprint(styleBytes(theme.css));
 const updateCss = currentCss === nextCss || currentCss === previous?.files['theme.css'] || !!known?.css.includes(currentCss) || !!known?.css.includes(await fingerprint(textBytes(old.css)));
 const contents = new Map<string, Uint8Array>([
  ['theme.css', textBytes(theme.css)], ['overrides.css', textBytes(overrides)],
  ...[...theme.assets].map(([path, bytes]) => ['assets/' + path, bytes] as [string, Uint8Array]),
 ]);
 for (const [path, next] of contents) {
  const target = path.startsWith('assets/') ? store.assetRoot(id) + '/' + path : directory + '/' + path;
  const stylesheet = path === 'theme.css' || path === 'overrides.css';
  const nextHash = await fingerprint(stylesheet ? styleBytes(new TextDecoder().decode(next)) : next); files[path] = nextHash;
  const exists = await store.storage.exists(target);
  const current = exists ? new Uint8Array(await store.storage.readBinary(target)) : null;
  const currentHash = current ? await fingerprint(stylesheet ? styleBytes(new TextDecoder().decode(current)) : current) : null;
  if (currentHash === nextHash) continue;
  let replace = !exists || (currentHash === previous?.files[path]);
  let replacement = next;
  if (path === 'theme.css') replace = updateCss;
  if (path === 'overrides.css' && current) {
   const text = new TextDecoder().decode(current).replace(/\r\n/gu, '\n');
   const bases = [...(previous?.overrides ? [previous.overrides] : []), ...(known?.overrides ?? [])]
    .map(value => value.replace(/\r\n/gu, '\n')).filter(Boolean).sort((a, b) => b.length - a.length);
   const base = bases.find(value => text.startsWith(value));
   if (base && updateCss) { replace = true; replacement = textBytes(overrides + text.slice(base.length)); }
   // A custom base stylesheet retains the defaults it was authored against.
   if (!updateCss) replace = false;
  }
  if (replace) {
   await mkdir(store, target.slice(0, target.lastIndexOf('/')));
   await store.storage.writeBinary(target, new Uint8Array(replacement).buffer);
  }
 }
 if (updateCss) {
  const manifest = { ...theme.manifest, name: old.manifest.name, origin: old.manifest.origin };
  for (const key of ['sourceApp', 'sourcePackage', 'packageId'] as const) {
   if (Object.hasOwn(old.manifest, key)) Object.assign(manifest, { [key]: old.manifest[key] });
  }
  const json = JSON.stringify(manifest, null, 2);
  if (await store.storage.read(directory + '/theme.json') !== json) await store.storage.write(directory + '/theme.json', json);
 }
 // Commit the revision last; interrupted upgrades are retried on the next load.
 await store.storage.write(directory + '/.bundled-state.json', JSON.stringify({ schemaVersion: 1, revision, files, overrides }));
}
