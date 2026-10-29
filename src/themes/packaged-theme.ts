import * as css from 'css-tree';
import type { ConvertedTheme, ThemeDiagnostic } from './model.js';
import { parseManifest, validateRelativePath, validateThemeId } from './store.js';
import { resolveThemeUrls, scopeOverrides } from './runtime-css.js';
import { cssName } from './resource-policy.js';
import { validateDelimiters } from './converter.js';

const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

function relocateFontDeclaration(node: css.CssNode, oldId: string, id: string): void {
	if (node.type !== 'Declaration' || (!['font-family', 'font'].includes(cssName(node.property)) && !node.property.startsWith('--'))) return;
	css.walk(node.value, part => {
		if (part.type === 'String' && part.value.startsWith(`paraflow-${oldId}-`)) part.value = `paraflow-${id}-` + part.value.slice(`paraflow-${oldId}-`.length);
		if (part.type === 'Identifier' && css.ident.decode(part.name).startsWith(`paraflow-${oldId}-`)) part.name = css.ident.encode(`paraflow-${id}-` + css.ident.decode(part.name).slice(`paraflow-${oldId}-`.length));
	});
}

/** Keep overrides as authored content selectors; runtime owns their scope. */
export function relocatePackagedOverrides(source: string, oldId: string, id: string): string {
	const ast = css.parse(source, { positions: true, parseCustomProperty: true, onParseError(error) { throw error; } });
	const tokens: { node: css.CssNode; before: string; from: number; to: number }[] = [];
	css.walk(ast, node => {
		if ((node.type === 'String' || node.type === 'Identifier') && node.loc) {
			tokens.push({ node, before: css.generate(node), from: node.loc.start.offset, to: node.loc.end.offset });
		}
	});
	css.walk(ast, node => relocateFontDeclaration(node, oldId, id));
	let result = source;
	for (const token of tokens.reverse()) {
		const after = css.generate(token.node);
		if (after !== token.before) result = result.slice(0, token.from) + after + result.slice(token.to);
	}
	return result;
}

/** Exported packages already contain content-scoped CSS, not Typora input. */
export function readPackagedTheme(files: ReadonlyMap<string, Uint8Array>): ConvertedTheme {
	const text = decode(files.get('theme.json')!);
	const metadata = JSON.parse(text) as { id?: unknown } | null;
	if (!metadata || typeof metadata.id !== 'string') throw new Error('Invalid packaged theme id');
	validateThemeId(metadata.id);
	const manifest = parseManifest(text, metadata.id);
	for (const key of ['converterVersion', 'sourceVersion', 'sourceEntry'] as const) {
		if (manifest[key] !== undefined && typeof manifest[key] !== 'string') throw new Error(`Invalid theme manifest: ${key}`);
	}
	if (manifest.sourceEntry) validateRelativePath(manifest.sourceEntry);
	const report: unknown = files.has('conversion-report.json') ? JSON.parse(decode(files.get('conversion-report.json')!)) : [];
	if (!Array.isArray(report) || !report.every((item: unknown) => {
		if (!item || typeof item !== 'object') return false;
		const entry = item as Partial<ThemeDiagnostic>;
		return typeof entry.file === 'string' && typeof entry.reason === 'string'
			&& typeof entry.line === 'number' && Number.isInteger(entry.line) && entry.line >= 0
			&& ['reading', 'live-preview', 'shared'].includes(entry.surface ?? '')
			&& ['mapped', 'approximate', 'skipped', 'error'].includes(entry.status ?? '');
	})) throw new Error('Invalid theme conversion report');
	const collect = (prefix: string): Map<string, Uint8Array> => new Map([...files]
		.filter(([path]) => path.startsWith(prefix)).map(([path, bytes]) => [path.slice(prefix.length), bytes]));
	const theme: ConvertedTheme = { manifest, css: decode(files.get('theme.css')!), assets: collect('assets/'),
		sources: collect('source/'), diagnostics: report as ThemeDiagnostic[] };
	// Validate before offering the package for installation, including local overrides.
	relocatePackagedTheme(theme, manifest.id, manifest.name);
	const overrides = files.has('overrides.css') ? decode(files.get('overrides.css')!) : '';
	validateDelimiters(overrides);
	resolveThemeUrls(scopeOverrides(overrides, manifest.id), path => {
		if (!theme.assets.has(path.slice(7))) throw new Error(`Missing theme asset: ${path}`);
		return path;
	});
	return theme;
}

export function relocatePackagedTheme(theme: ConvertedTheme, id: string, name: string): ConvertedTheme {
	validateThemeId(id);
	const oldId = theme.manifest.id;
	validateDelimiters(theme.css);
	const ast = css.parse(theme.css, { parseCustomProperty: true, onParseError(error) { throw error; } });
	css.walk(ast, node => {
		if (node.type === 'Raw') throw new Error('Invalid packaged theme CSS');
		if (node.type === 'Atrule') {
			if (!['media', 'supports', 'font-face'].includes(cssName(node.name))) throw new Error(`Unsupported packaged theme at-rule: @${node.name}`);
			if (cssName(node.name) === 'font-face') {
				const families = node.block?.children.toArray().filter(child => child.type === 'Declaration' && cssName(child.property) === 'font-family') ?? [];
				if (!families.length) throw new Error('Missing packaged theme font family');
				for (const family of families) {
					if (family.type !== 'Declaration' || family.value.type !== 'Value' || family.value.children.size !== 1
						|| !['String', 'Identifier'].includes(family.value.children.first!.type)) throw new Error('Invalid packaged theme font family');
					const value = family.value.children.first!;
					const text = value.type === 'String' ? value.value : value.type === 'Identifier' ? css.ident.decode(value.name) : '';
					if (!text.startsWith(`paraflow-${oldId}-`)) throw new Error('Unscoped packaged theme font family');
				}
			}
		}
		if (node.type === 'Rule') {
			if (node.prelude.type !== 'SelectorList') throw new Error('Invalid packaged theme selector');
			for (const selector of node.prelude.children) {
				if (selector.type !== 'Selector') throw new Error('Invalid packaged theme selector');
				const children = selector.children.toArray();
				const [body, owner] = children;
				if (body?.type !== 'TypeSelector' || cssName(body.name) !== 'body'
					|| owner?.type !== 'AttributeSelector' || cssName(owner.name.name) !== 'data-paraflow-theme'
					|| owner.matcher !== '=' || owner.flags !== null || owner.value?.type !== 'String' || owner.value.value !== oldId) {
					throw new Error('Unscoped packaged theme selector');
				}
				let contentIndex = children.findIndex(child => child.type === 'Combinator');
				if (children[contentIndex + 1]?.type === 'ClassSelector' && cssName((children[contentIndex + 1] as css.ClassSelector).name) === 'workspace-leaf-content') {
					const leafBoundary = children[contentIndex], kind = children[contentIndex + 2];
					if (leafBoundary?.type !== 'Combinator' || ![' ', '>'].includes(leafBoundary.name)
						|| kind?.type !== 'AttributeSelector' || cssName(kind.name.name) !== 'data-type' || kind.matcher !== '='
						|| kind.flags !== null || kind.value?.type !== 'String' || kind.value.value !== 'markdown') {
						throw new Error('Packaged theme workspace selector must target a Markdown leaf');
					}
					contentIndex += 3;
				}
				const boundary = children[contentIndex];
				const content = children[contentIndex + 1];
				if (boundary?.type !== 'Combinator' || ![' ', '>'].includes(boundary.name)
					|| content?.type !== 'ClassSelector' || !['markdown-reading-view', 'markdown-source-view'].includes(cssName(content.name))) {
					throw new Error('Packaged theme selector must target Markdown content');
				}
				const nextBoundary = children.slice(contentIndex + 2).find(child => child.type === 'Combinator');
				if (nextBoundary?.type === 'Combinator' && ['+', '~'].includes(nextBoundary.name)) throw new Error('Unscoped packaged theme selector');
				owner.value.value = id;
			}
		}
		relocateFontDeclaration(node, oldId, id);
	});
	const output = css.generate(ast);
	resolveThemeUrls(output, path => {
		if (!theme.assets.has(path.slice(7))) throw new Error(`Missing theme asset: ${path}`);
		return path;
	});
	return { ...theme, manifest: { ...theme.manifest, id, name }, css: output };
}
