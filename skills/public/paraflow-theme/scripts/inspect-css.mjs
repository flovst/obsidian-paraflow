import { readFileSync } from 'node:fs';
import { inspectCss, isMain } from './css.mjs';
export { inspectCss } from './css.mjs';

export function main(args = process.argv.slice(2)) {
  const files = [];
  for (const arg of args) {
    if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    files.push(arg);
  }
  if (!files.length) {
    throw new Error('Usage: node inspect-css.mjs file.css [...]');
  }
  const result = inspectCss(files.map(filename => ({ filename, css: readFileSync(filename, 'utf8') })));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (isMain(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
