import type { ThemeManifest } from './model.js';
import { validateThemeId } from './store.js';

export interface ThemeOverrides {
 colorScheme?: 'host' | 'light' | 'dark';
 accentColor?: string;
 fontFamily?: string;
 fontSize?: number | 'host';
 fontWeight?: number | 'host';
 width?: number | 'host';
 lineHeight?: number | 'host';
 marker?: 'layered' | 'disc' | 'circle' | 'square';
 metadataLayout?: 'content' | 'native';
 metadataPadding?: number;
 metadataGap?: number;
}

export function supportsThemeColorScheme(theme: ThemeManifest | null | undefined): boolean {
 // Converted CSS keeps its own colors and media rules; the converter does not create palette variants.
 return theme == null || theme.origin === 'builtin';
}

export function normalizeThemeOverrides(value: unknown): ThemeOverrides {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
 const source = value as Record<string, unknown>;
 const result: ThemeOverrides = {};
 if (['host', 'light', 'dark'].includes(String(source.colorScheme))) result.colorScheme = source.colorScheme as ThemeOverrides['colorScheme'];
 if (typeof source.accentColor === 'string' && /^(?:host|#[a-f\d]{6})$/iu.test(source.accentColor)) result.accentColor = source.accentColor;
 if (typeof source.fontFamily === 'string' && source.fontFamily.trim() && source.fontFamily.length <= 300 && !/[;{}<>\\\r\n]|\/\*/u.test(source.fontFamily)) result.fontFamily = source.fontFamily.trim();
 for (const [key, min, max] of [['fontSize', 10, 48], ['width', 320, 1600], ['lineHeight', 1, 2.5]] as const) {
  const v = source[key];
  if (v === 'host' || (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max)) result[key] = v;
 }
 if (source.fontWeight === 'host' || (typeof source.fontWeight === 'number' && [300, 400, 500].includes(source.fontWeight))) result.fontWeight = source.fontWeight;
 if (['layered', 'disc', 'circle', 'square'].includes(String(source.marker))) result.marker = source.marker as ThemeOverrides['marker'];
 if (source.metadataLayout === 'content' || source.metadataLayout === 'native') result.metadataLayout = source.metadataLayout;
 for (const [key,max] of [['metadataPadding',100],['metadataGap',300]] as const) {
  const v=source[key];
  if (typeof v==='number' && Number.isFinite(v) && v>=0 && v<=max) result[key]=v;
 }
 return result;
}

export function themeRoots(id: string): { body: string; live: string; source: string; reading: string; roots: string; widthRoots: string } {
 validateThemeId(id);
 const body = `body[data-paraflow-theme="${id}"]`;
 const live = `${body} .markdown-source-view.mod-cm6.is-live-preview:not(:is(.cm-table-widget *))`;
 const reading = `${body} .markdown-reading-view`;
 const source = `${body} .markdown-source-view.mod-cm6:not(.is-live-preview):not(:is(.cm-table-widget *))`;
 return { body, live, source, reading, roots: `${live},${reading}`, widthRoots: `${live},${source},${reading}` };
}

export function themeOverrideCss(id: string, value: ThemeOverrides): string {
 const {roots,live,source,reading,widthRoots} = themeRoots(id);
 const declarations: string[] = [];
 const put = (name: string, v: string) => declarations.push(`${name}:${v}!important`);
 if (value.fontFamily) {
  const v = value.fontFamily === 'host' ? 'var(--paraflow-host-font)' : value.fontFamily;
  put('--paraflow-content-font',v); put('--paraflow-paragraph-font',v); put('--paraflow-list-font',v);
 }
 if (value.fontSize) {
  const v = value.fontSize === 'host' ? 'var(--paraflow-host-size)' : `${value.fontSize}px`;
  for (const name of ['content-font-size','paragraph-size','list-size']) put(`--paraflow-${name}`,v);
 }
 if (value.fontWeight) {
  const v = value.fontWeight === 'host' ? 'var(--paraflow-host-weight)' : String(value.fontWeight);
  put('--paraflow-paragraph-weight',v); put('--paraflow-list-weight',v);
 }
 if (value.lineHeight) {
  const v = value.lineHeight === 'host' ? 'var(--paraflow-host-line-height)' : String(value.lineHeight);
  put('--paraflow-paragraph-line-height',v); put('--paraflow-content-line-height',v); put('--paraflow-list-line-height',v);
 }
 if (value.accentColor) {
  const v = value.accentColor === 'host' ? 'var(--paraflow-host-accent)' : value.accentColor;
  put('--paraflow-link-color',v); put('--paraflow-link-override',v); put('--interactive-accent',v); put('--text-accent',v);
 }
 if (value.marker) {
  const layered = value.marker === 'layered';
  put('--paraflow-marker-size',layered ? 'initial' : value.marker === 'circle' ? '0.4375em' : '0.375em');
  put('--paraflow-marker-radius',layered ? 'initial' : value.marker === 'square' ? '0' : '50%');
  put('--paraflow-marker-background',layered ? 'initial' : value.marker === 'circle' ? 'transparent' : 'var(--paraflow-marker-color,var(--text-normal))');
  put('--paraflow-marker-border',layered ? 'initial' : value.marker === 'circle' ? '1px solid var(--paraflow-marker-color,var(--text-normal))' : '0');
 }
 let output = declarations.length ? `${roots},${source}{${declarations.join(';')}}` : '';
 if (typeof value.width === 'number') output += `${widthRoots}{--paraflow-content-width:${value.width}px!important;--paraflow-text-width:${value.width}px!important}`;
 if (value.width === 'host') {
  output += `${widthRoots}{--paraflow-content-width:none!important;--paraflow-text-width:none!important}`;
  output += `${live}.is-readable-line-width,${source}.is-readable-line-width,${reading}:has(.markdown-preview-view.is-readable-line-width){--paraflow-content-width:var(--paraflow-host-width)!important;--paraflow-text-width:var(--paraflow-host-width)!important}`;
 }
 if (value.marker) {
  const item = '>li:not(.task-list-item):not(:is(.callout *,.markdown-embed *))';
  output += `${reading} ul${item}{list-style-type:${value.marker === 'layered' ? 'disc' : value.marker}!important}`;
  if (value.marker === 'layered') {
   output += `${reading} ul ul${item}{list-style-type:circle!important}${reading} ul ul ul${item}{list-style-type:square!important}`;
  }
 }
 return output;
}

export function themePaletteCss(id: string, scheme: ThemeManifest['colorScheme']): string {
 if (scheme === 'adaptive') return '';
 const {roots,source} = themeRoots(id);
 const dark = scheme === 'dark';
 const colors: Record<string,string> = {
  '--paraflow-math-rendered-color':dark?'var(--paraflow-content-color,var(--text-normal))':'#4d4d4d',
  '--background-primary':dark?'#363b40':'#ffffff', '--background-secondary':dark?'#2f3338':'#f6f6f6',
  '--text-normal':dark?'#dadada':'#333333', '--text-muted':dark?'#aeb4bb':'#666666',
  '--text-faint':dark?'#90979f':'#777777', '--background-modifier-border':dark?'#50565d':'#dddddd',
  '--code-normal':dark?'#dadada':'#333333','--code-background':dark?'#303438':'#f6f6f6',
  '--text-highlight-bg':dark?'rgba(255,208,0,.25)':'rgba(255,208,0,.35)',
  '--text-selection':dark?'rgba(120,160,210,.3)':'rgba(80,140,220,.2)',
  '--checkbox-border-color':dark?'#90979f':'#777777', '--checklist-done-color':dark?'#aeb4bb':'#777777',
  '--table-header-color':dark?'#dadada':'#333333', '--table-border-color':dark?'#50565d':'#dddddd',
  '--metadata-label-text-color':dark?'#aeb4bb':'#666666', '--metadata-input-text-color':dark?'#dadada':'#333333',
  '--code-comment':dark?'#9aa5b1':'#687787', '--code-keyword':dark?'#e5a4ce':'#a626a4',
  '--code-string':dark?'#b1c98b':'#508020', '--code-number':dark?'#d4ac82':'#986801',
  '--code-function':dark?'#86bde7':'#356eae', '--code-property':dark?'#d4c48d':'#806615',
 };
 return `${roots},${source}{color-scheme:${scheme};${Object.entries(colors).map(([k,v])=>`${k}:${v}`).join(';')}}`;
}
