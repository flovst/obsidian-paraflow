import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const roles = ['background', 'text', 'muted', 'surface', 'border', 'link', 'codeText', 'codeBackground'];
const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const encoded = value => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
function rgb(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected opaque #rrggbb semantic color: ${hex}`);
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
}
const hex = values => '#' + values.map(value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0')).join('');
function oklab(color) {
  const [r, g, b] = rgb(color).map(linear);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .7936177850 * m - .0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .8086757660 * s];
}
function fromLab([L, a, b]) {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.7076147010 * s];
}
// Reduce chroma along the same hue until the target lightness fits sRGB.
function atLightness(color, L, scale = 1) {
  const [, a, b] = oklab(color);
  for (let attempt = 0; attempt < 80; attempt++, scale *= .9) {
    const candidate = fromLab([L, a * scale, b * scale]);
    if (candidate.every(value => value >= -1e-7 && value <= 1 + 1e-7)) return hex(candidate.map(encoded));
  }
  throw new Error('Palette gamut mapping failed');
}
export function contrast(first, second) {
  const luminance = color => rgb(color).map(linear).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
function foreground(color, background, dark, minimum = 4.5, start = dark ? .82 : .32) {
  for (let step = 0; step <= 100; step++) {
    const L = start + ((dark ? .99 : .05) - start) * step / 100;
    const value = atLightness(color, L);
    if (contrast(value, background) >= minimum) return value;
  }
  throw new Error(`Cannot reach contrast ${minimum}`);
}
export function derivePalette(input, from) {
  if (!['light', 'dark'].includes(from)) throw new Error('--from must be light or dark');
  for (const role of roles) { if (!input[role]) throw new Error(`Missing semantic role: ${role}`); rgb(input[role]); }
  const unknown = Object.keys(input).filter(key => !roles.includes(key) && !['highlight', 'selection', ...Array.from({ length: 6 }, (_, index) => `h${index + 1}`)].includes(key));
  if (unknown.length) throw new Error(`Unmapped roles: ${unknown.join(', ')}`);
  for (const value of Object.values(input)) rgb(value);
  const sourceLight = contrast(input.background, '#000000') > contrast(input.background, '#ffffff');
  if (sourceLight !== (from === 'light')) throw new Error('Source mode conflicts with background luminance');
  const dark = from === 'light';
  const result = { background: atLightness(input.background, dark ? .2 : .975, .45) };
  result.surface = atLightness(input.surface, dark ? .26 : .94, .5);
  result.codeBackground = atLightness(input.codeBackground, dark ? .245 : .95, .5);
  for (const role of ['text', 'muted', 'link']) result[role] = foreground(input[role], result.background, dark, 4.5,
    role === 'muted' ? (dark ? .69 : .47) : role === 'link' ? (dark ? .76 : .43) : (dark ? .85 : .3));
  result.codeText = foreground(input.codeText, result.codeBackground, dark);
  result.border = foreground(input.border, result.background, dark, 1.5, dark ? .4 : .8);
  for (const role of Object.keys(input).filter(role => /^h[1-6]$/.test(role))) result[role] = foreground(input[role], result.background, dark);
  for (const role of ['highlight', 'selection'].filter(role => input[role])) {
    // These are opaque composited backgrounds, so keep readable foreground contrast.
    result[role] = atLightness(input[role], dark ? .32 : .87, .65);
    if (contrast(result.text, result[role]) < 4.5) result[role] = result.surface;
  }
  return { status: 'generated-draft', from, to: dark ? 'dark' : 'light', palette: result,
    contrast: { body: contrast(result.text, result.background), muted: contrast(result.muted, result.background), link: contrast(result.link, result.background), code: contrast(result.codeText, result.codeBackground) },
    review: ['Compare the source theme identity; generated colors are a draft.', 'Resolve and composite translucent source colors before input.', 'Audit table stripes, code syntax, math, diagrams and assets separately.', 'Keep shared typography/layout and bind every painted color to semantic roles.'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { input: { type: 'string' }, from: { type: 'string' }, output: { type: 'string' } } });
  if (!values.input || !values.output) throw new Error('Usage: node derive-palette.mjs --input palette.json --from light|dark --output NEW.json');
  const result = derivePalette(JSON.parse(readFileSync(values.input, 'utf8')), values.from);
  writeFileSync(values.output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(`${result.status}: ${result.from} → ${result.to}; body contrast ${result.contrast.body.toFixed(2)}\n`);
}
