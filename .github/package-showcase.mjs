import { existsSync, lstatSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const pluginDirectory = 'showcase-paraflow/.obsidian/plugins/paraflow';

function checkedPath(root, path) {
  if (isAbsolute(path) || /[\\:]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid package path: ${path}`);
  }
  const target = resolve(root, path);
  let current = parse(target).root;
  for (const part of target.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Symlink/junction not allowed: ${current}`);
  }
  return target;
}

export function showcaseTemplate(root) {
  const paths = JSON.parse(readFileSync(checkedPath(root, '.github/showcase-files.json'), 'utf8')).paths;
  const files = new Map();
  for (const path of paths) {
    if (!path.startsWith('showcase-paraflow/') || /(^|\/)(\.git|node_modules|cache|workspace[^/]*\.json)(\/|$)/i.test(path)) {
      throw new Error(`Unreviewed showcase path: ${path}`);
    }
    if (path.startsWith(`${pluginDirectory}/`) && path !== `${pluginDirectory}/data.json`) throw new Error(`Generated plugin file in template: ${path}`);
    if (path.startsWith('showcase-paraflow/.obsidian/plugins/') && path !== `${pluginDirectory}/data.json`) throw new Error(`Unreviewed plugin file: ${path}`);
    const source = checkedPath(root, path);
    if (!lstatSync(source).isFile()) throw new Error(`Expected regular file: ${path}`);
    if (files.has(path)) throw new Error(`Duplicate showcase path: ${path}`);
    files.set(path, readFileSync(source));
  }
  for (const required of ['README.md', '.obsidian/community-plugins.json', '.obsidian/plugins/paraflow/data.json']) {
    if (!files.has(`showcase-paraflow/${required}`)) throw new Error(`Missing showcase template file: ${required}`);
  }
  const plugins = JSON.parse(files.get('showcase-paraflow/.obsidian/community-plugins.json'));
  if (JSON.stringify(plugins) !== '["paraflow"]') throw new Error('Showcase enables an unbundled plugin');
  const appearance = JSON.parse(files.get('showcase-paraflow/.obsidian/appearance.json'));
  if ((appearance.enabledCssSnippets ?? []).length) throw new Error('Showcase snippets must be disabled');
  return files;
}

export async function packageShowcase({ root = projectRoot, buildRoot = root, outputDirectory = 'dist', syncInstall = false } = {}) {
  const { zipSync } = await import('fflate');
  const files = showcaseTemplate(root);
  const manifest = JSON.parse(readFileSync(checkedPath(buildRoot, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(checkedPath(buildRoot, 'package.json'), 'utf8'));
  if (manifest.id !== 'paraflow' || !/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.version !== pkg.version) {
    throw new Error('Build manifest must identify ParaFlow and match package version');
  }
  const assets = ['main.js', 'manifest.json', 'styles.css'];
  for (const name of assets) {
    const asset = checkedPath(buildRoot, name);
    if (!lstatSync(asset).isFile() || !lstatSync(asset).size) throw new Error(`Missing build artifact: ${name}`);
    files.set(`${pluginDirectory}/${name}`, readFileSync(asset));
  }
  for (const name of ['LICENSE', 'THIRD-PARTY-NOTICES.txt']) {
    files.set(`showcase-paraflow/${name}`, readFileSync(checkedPath(buildRoot, name)));
  }
  const archive = checkedPath(root, `${outputDirectory}/showcase-paraflow-${manifest.version}.zip`);
  if (existsSync(archive)) throw new Error(`Archive already exists: ${archive}`);
  // Validate all installation targets before writing any build artifact.
  const installs = syncInstall ? assets.map(name => [checkedPath(root, `${pluginDirectory}/${name}`), files.get(`${pluginDirectory}/${name}`)]) : [];
  const entries = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([path, bytes]) => [path, [bytes, { mtime: new Date(2000, 0, 1) }]]));
  const zip = zipSync(entries, { level: 6 });
  mkdirSync(dirname(archive), { recursive: true });
  writeFileSync(archive, zip, { flag: 'wx' });
  for (const [target, bytes] of installs) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  return { archive, version: manifest.version, files: files.size, installed: syncInstall };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--sync-install') options.syncInstall = true;
    else if (arg === '--build-root' && args[index + 1]) options.buildRoot = resolve(args[++index]);
    else if (arg === '--output-dir' && args[index + 1]) options.outputDirectory = args[++index];
    else throw new Error('Usage: node .github/package-showcase.mjs [--build-root directory] [--output-dir relative-directory] [--sync-install]');
  }
  console.log(JSON.stringify(await packageShowcase(options)));
}
