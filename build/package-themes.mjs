import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { themeRuntimeBytes } from './theme-bundles.mjs';

export function packageThemes(root = resolve(fileURLToPath(new URL('..', import.meta.url))), check = false) {
 /** @type {string[]} */
 const catalogue = JSON.parse(readFileSync(join(root, 'themes/downloads.json'), 'utf8'));
 const output = join(root, 'themes/downloads'); if (!check) mkdirSync(output, { recursive: true });
 const results = [];
 for (const id of catalogue) {
  if (!/^[a-z0-9-]+$/u.test(id)) throw new Error('Invalid theme directory');
  const directory = join(root, 'themes', id); const files = {};
  const visit = (path = '') => {
   for (const entry of readdirSync(join(directory, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.name === 'source' || entry.name.startsWith('.')) continue;
    const child = path + entry.name;
    if (entry.isDirectory()) visit(child + '/');
    else if (entry.isFile()) files[child] = [new Uint8Array(themeRuntimeBytes(child, readFileSync(join(directory, child)))), { mtime: new Date(2000, 0, 1) }];
    else throw new Error('Linked theme resource: ' + child);
   }
  };
  visit();
  if (!files['theme.json']) throw new Error('Missing theme manifest: ' + id);
  const path = join(output, id + '.zip'); const bytes = zipSync(files, { level: 9 });
  if (check) { if (!Buffer.from(bytes).equals(readFileSync(path))) throw new Error('Theme ZIP is stale: ' + id); }
  else writeFileSync(path, bytes);
  results.push({ id, path: relative(root, path).replaceAll('\\', '/'), bytes: bytes.length });
 }
 return results;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.stdout.write(JSON.stringify(packageThemes(undefined, process.argv.includes('--check')), null, 2) + '\n');
