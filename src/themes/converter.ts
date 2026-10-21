import * as css from 'css-tree';
import { blockProperties, mapSelector, paintProperties, rootTokens, tableTags, textProperties } from './css-mapping';
import type { ConvertedTheme, ThemeDiagnostic, ThemeInput } from './model';
import { projectHeadingThemeSelectors } from './heading-selectors.js';
import { projectContentThemeSelectors } from './content-selectors.js';
import { projectQuoteThemeTokens } from './quote-selectors.js';
import { cssName, themeResource } from './resource-policy.js';

export const CONVERTER_VERSION = '7';
interface SourceRule { node: css.Rule | css.Atrule; file: string; media: string[] }

const lengthValue = (value: string): string => /^[+-]?0(?:\.0+)?$/u.test(value) ? '0px' : value;

function boxSides(value: string): string[] {
	const ast = css.parse(value, { context: 'value' }) as css.Value;
	const parts = ast.children.toArray().map(node => lengthValue(css.generate(node)));
	return [parts[0]!, parts[1] ?? parts[0]!, parts[2] ?? parts[0]!, parts[3] ?? parts[1] ?? parts[0]!];
}

function headingRelativeLength(value: string, tag: string): string {
	const ast = css.parse(value, { context: 'value' });
	css.walk(ast, node => {
		if (node.type !== 'Dimension' || node.unit !== 'em') return;
		const replacement = css.parse(`calc(${node.value} * var(--paraflow-${tag}-size))`, { context: 'value' }) as css.Value;
		Object.assign(node, replacement.children.first);
	});
	return css.generate(ast);
}

function codeRelativeLength(value: string): string {
	return value.replace(/([\d.]+)em\b/gu, 'calc($1 * var(--paraflow-block-code-size,.9em))');
}

function brightness(value: string): number | null {
	const named: Record<string, string> = { black: '#000000', white: '#ffffff' };
	const hex = named[value.toLowerCase()] ?? value;
	const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(hex);
	if (!match) return null;
	const digits = match[1] ?? '';
	const parts = digits.length === 3 ? [...digits].map(part => parseInt(part + part, 16)) : [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16));
	return (parts[0]! * .2126 + parts[1]! * .7152 + parts[2]! * .0722) / 255;
}

// css-tree's parser intentionally recovers missing closing delimiters. Imports reject them.
function validateDelimiters(source: string): void {
	const tokenizer = css as typeof css & {
		tokenTypes: Record<string, number>;
		tokenize: (text: string, callback: (type: number) => void) => void;
	};
	const types = tokenizer.tokenTypes;
	const openings = new Map([[types.LeftCurlyBracket, types.RightCurlyBracket], [types.LeftSquareBracket, types.RightSquareBracket], [types.LeftParenthesis, types.RightParenthesis], [types.Function, types.RightParenthesis]]);
	const closing = new Set([types.RightCurlyBracket, types.RightSquareBracket, types.RightParenthesis]);
	const stack: (number | undefined)[] = [];
	tokenizer.tokenize(source, type => {
		if (openings.has(type)) stack.push(openings.get(type));
		else if (closing.has(type) && stack.pop() !== type) throw new Error('Mismatched CSS delimiter');
		else if (type === types.BadString || type === types.BadUrl) throw new Error('Invalid CSS string or URL');
	});
	if (stack.length) throw new Error('Unclosed CSS delimiter');
}

function packagePath(path: string, from = ''): string {
	if (/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(path)) throw new Error(`Path outside import package: ${path}`);
	const parts = from.split('/').slice(0, -1);
	for (const part of path.replace(/\\/g, '/').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			if (!parts.length) throw new Error(`Path escapes import package: ${path}`);
			parts.pop();
		} else parts.push(part);
	}
	return parts.join('/');
}

function remoteUrl(value: string): boolean {
	return /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value);
}

function familyName(value: css.CssNode): string {
	if (value.type === 'Value' && value.children.size === 1 && value.children.first?.type === 'String') return value.children.first.value;
	return css.generate(value).trim();
}

export function convertTyporaTheme(input: ThemeInput, options: { id: string; name: string; sourceVersion?: string }): ConvertedTheme {
	if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(options.id)) throw new Error('Invalid theme ID');
	const files = new Map<string, Uint8Array>();
	for (const [path, data] of input.files) {
		const normalized = packagePath(path);
		if (!normalized || files.has(normalized)) throw new Error(`Conflicting package path: ${path}`);
		files.set(normalized, data);
	}
	const diagnostics: ThemeDiagnostic[] = [];
	const assets = new Map<string, Uint8Array>();
	const rules: SourceRule[] = [];
	const fonts = new Map<string, string>();
	const report = (file: string, node: css.CssNode, status: ThemeDiagnostic['status'], reason: string, surface: ThemeDiagnostic['surface'] = 'shared') => {
		diagnostics.push({ file, line: node.loc?.start.line ?? 1, surface, status, reason });
	};
	let importVisits = 0;
	const collect = (file: string, stack: string[], media: string[]) => {
		if (++importVisits > 2000) throw new Error('CSS import expansion exceeds 2,000 visits');
		if (stack.includes(file)) throw new Error(`Cyclic CSS import: ${[...stack, file].join(' -> ')}`);
		if (stack.length > 64) throw new Error('CSS import nesting exceeds 64 files');
		const data = files.get(file);
		if (!data) throw new Error(`Missing required CSS file: ${file}`);
		let ast: css.CssNode;
		try {
			const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
			validateDelimiters(text);
			ast = css.parse(text, { positions: true, filename: file, parseCustomProperty: true, onParseError(error) { throw error; } });
		} catch (error) { throw new Error(`CSS parse/syntax error in ${file}: ${String(error)}`); }
		if (ast.type !== 'StyleSheet') throw new Error(`Invalid CSS stylesheet: ${file}`);
		const visit = (children: css.List<css.CssNode>, conditions: string[]) => {
			for (const node of children) {
				if (node.type === 'Rule') {
					if (rules.length >= 20000) throw new Error('CSS rule expansion exceeds 20,000 rules');
					rules.push({ node, file, media: conditions }); continue;
				}
				if (node.type === 'Comment') continue;
				if (node.type !== 'Atrule') throw new Error(`CSS syntax error in ${file}:${node.loc?.start.line ?? 1}`);
				const name = cssName(node.name);
				if (name === 'charset') continue;
				if (name === 'import') {
					const prelude = node.prelude;
					const first = prelude?.type === 'AtrulePrelude' ? prelude.children.first : null;
					if (!first || (first.type !== 'String' && first.type !== 'Url')) throw new Error(`Invalid CSS import in ${file}`);
					if (remoteUrl(first.value)) { report(file, node, 'skipped', `External CSS import is not downloaded: ${first.value}`); continue; }
					const rest = prelude?.type === 'AtrulePrelude' ? prelude.children.toArray().slice(1).map(item => css.generate(item)).join(' ') : '';
					if (/\b(?:layer|supports)\b/.test(rest)) { report(file, node, 'skipped', 'Import layer/supports conditions are unsupported'); continue; }
					if (/\bprint\b/.test(rest)) { report(file, node, 'skipped', 'Print import is outside content theme scope'); continue; }
					collect(packagePath(first.value, file), [...stack, file], rest ? [...conditions, rest] : conditions);
				} else if (name === 'media' && node.block && node.prelude) {
					const condition = css.generate(node.prelude);
					if (/\bprint\b/.test(condition)) report(file, node, 'skipped', 'Print media is outside content theme scope');
					else visit(node.block.children, [...conditions, condition]);
				} else if (name === 'font-face' && node.block) {
					for (const declaration of node.block.children) {
						if (declaration.type === 'Declaration' && declaration.property === 'font-family') {
							const family = familyName(declaration.value);
							fonts.set(family.toLowerCase(), `paraflow-${options.id}-${family}`);
						}
						}
					rules.push({ node, file, media: conditions });
				} else report(file, node, 'skipped', `Unsupported @${name}; no global rule emitted`);
			}
		};
		visit(ast.children, media);
	};
	collect(packagePath(input.entry), [], []);
	if (rules[0]) report(rules[0].file, rules[0].node, 'approximate', 'Content scope normalization preserves rule/declaration order, but removed html/body/#write selector specificity may differ');

	let rootFontSize = '14px';
	let schemeForeground: string | null = null;
	let schemeBackground: string | null = null;
	const rootColorVariables = new Map<string, string>();
	const conditionalColorVariables = new Set<string>();
	for (const { node, file, media } of rules) {
		if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') continue;
		for (const selector of node.prelude.children) {
			const mapping = selector.type === 'Selector' ? mapSelector(selector) : null;
			if (!mapping?.root) continue;
			for (const declaration of node.block.children) {
				if (declaration.type !== 'Declaration') continue;
				const value = css.generate(declaration.value);
				if (declaration.property.startsWith('--')) {
					if (media.length) conditionalColorVariables.add(declaration.property);
					else rootColorVariables.set(declaration.property, value);
				}
				if (mapping.rootKind === 'html' && declaration.property === 'font-size') {
					if (!media.length && /^\d+(?:\.\d+)?px$/.test(value) && parseFloat(value) > 0) rootFontSize = value;
					else report(file, declaration, 'approximate', 'Unsupported conditional or non-pixel html rem baseline');
				}
				if (!media.length && ['body', 'write'].includes(mapping.rootKind ?? '')) {
					if (declaration.property === 'color') schemeForeground = value;
					if (['background', 'background-color'].includes(declaration.property)) schemeBackground = value;
				}
			}
		}
	}
	const resolveRootColor = (source: string | null): string | null => {
		let value = source;
		const seen = new Set<string>();
		while (value !== null) {
			const variable = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)?.[1];
			if (!variable) return value;
			if (seen.has(variable) || conditionalColorVariables.has(variable)) return null;
			seen.add(variable);
			value = rootColorVariables.get(variable) ?? null;
		}
		return null;
	};
	const resolvedForeground = resolveRootColor(schemeForeground);
	const resolvedBackground = resolveRootColor(schemeBackground);
	const foregroundBrightness = resolvedForeground === null ? null : brightness(resolvedForeground);
	const backgroundBrightness = resolvedBackground === null ? null : brightness(resolvedBackground);
	const colorScheme = foregroundBrightness !== null && backgroundBrightness !== null && Math.abs(foregroundBrightness - backgroundBrightness) >= .3
		? backgroundBrightness < .5 ? 'dark' : 'light' : 'adaptive';

	const fontVariables = new Set<string>();
	const customValues = new Map<string, css.CssNode>();
	const collectFontVariables = (value: css.CssNode): void => {
		css.walk(value, node => {
			if (node.type === 'Function' && node.name === 'var' && node.children.first?.type === 'Identifier') fontVariables.add(node.children.first.name);
		});
	};
	for (const { node } of rules) for (const declaration of node.block?.children ?? []) {
		if (declaration.type !== 'Declaration') continue;
		if (declaration.property.startsWith('--')) customValues.set(declaration.property, declaration.value);
		if (declaration.property === 'font-family') collectFontVariables(declaration.value);
	}
	for (const variable of fontVariables) { const value = customValues.get(variable); if (value) collectFontVariables(value); }

	const rewriteValue = (declaration: css.Declaration, source: SourceRule, fontFace = false): string | null => {
		const value = css.clone(declaration.value);
		let usable = true;
		css.walk(value, node => {
			const resource = themeResource(node);
			if (resource && 'kind' in resource && resource.kind === 'unsupported-function') {
				report(source.file, declaration, 'skipped', `Unsupported resource function ${resource.name}`); usable = false;
			}
			if (node.type === 'Dimension' && node.unit.toLowerCase() === 'rem') {
				const replacement = css.parse(`calc(${node.value} * var(--paraflow-root-font-size, 16px))`, { context: 'value' }) as css.Value;
				Object.assign(node, replacement.children.first);
			}
			if (node.type === 'Url') {
				if (remoteUrl(node.value)) { report(source.file, declaration, 'skipped', `External resource omitted: ${node.value}`); usable = false; return; }
				const [urlPath, suffix = ''] = node.value.split(/(?=[?#])/);
				const path = packagePath(decodeURIComponent(urlPath ?? ''), source.file);
				const data = files.get(path);
				if (!data) { report(source.file, declaration, 'skipped', `Missing optional ${fontFace ? 'font' : 'asset'}: ${path}`); usable = false; return; }
				assets.set(path, data);
				node.value = `assets/${path.split('/').map(part => encodeURIComponent(part)).join('/')}${suffix}`;
			}
		});
		if (!usable) return null;
		if ((declaration.property === 'font-family' || fontVariables.has(declaration.property)) && value.type === 'Value') {
			const groups: css.CssNode[][] = [[]];
			for (const child of value.children) {
				if (child.type === 'Operator' && child.value === ',') groups.push([]);
				else groups[groups.length - 1]?.push(child);
			}
			return groups.map(group => {
				const groupValue: css.Value = { type: 'Value', children: new css.List<css.CssNode>().fromArray(group) };
				const name = fonts.get(familyName(groupValue).toLowerCase());
				return name ? css.generate({ type: 'String', value: name }) : css.generate(groupValue);
			}).join(',');
		}
		return css.generate(value);
	};
	const scope = `body[data-paraflow-theme="${options.id}"]`;
	const reading = `${scope} .markdown-reading-view`;
	const live = `${scope} .markdown-source-view.mod-cm6.is-live-preview:not(:is(.cm-table-widget *))`;
	const rootSelectors = `${reading},${live}`;
	const output: string[] = [];
	let mapped = 0;
	const emit = (source: SourceRule, content: string) => output.push(source.media.reduceRight((inner, condition) => `@media ${condition}{${inner}}`, content));
	output.push(`${rootSelectors}{--paraflow-root-font-size:${rootFontSize};--paraflow-content-font-size:var(--paraflow-root-font-size)}`);
	// Small content baseline from Typora 1.9.x; theme declarations below take precedence.
	output.push(`${rootSelectors}{--paraflow-page-padding-left:30px;--paraflow-page-padding-right:30px;--paraflow-heading-following-gap:0px;--paraflow-p-margin-top:var(--paraflow-root-font-size);--paraflow-p-margin-bottom:var(--paraflow-root-font-size)}`);
	output.push(`${reading} p:not(:is(.callout,.callout *,.markdown-embed,.markdown-embed *)){margin-block:var(--paraflow-root-font-size)}`);
	for (let level=1;level<=6;level++) {
		const size = `calc(${[2,1.8,1.6,1.4,1.2,1][level-1]} * var(--paraflow-root-font-size))`;
		output.push(`${rootSelectors}{--paraflow-h${level}-size:${size};--paraflow-h${level}-margin-top:var(--paraflow-root-font-size);--paraflow-h${level}-margin-bottom:var(--paraflow-root-font-size)}`);
		output.push(`${reading} h${level}:not(:is(.callout,.callout *,.markdown-embed,.markdown-embed *)){font-size:${size};margin-block:var(--paraflow-root-font-size)}`);
		output.push(`${live} .HyperMD-header-${level}:not(:is(.callout,.callout *,.markdown-embed,.markdown-embed *)){font-size:var(--paraflow-h${level}-size)}${live} .cm-header-${level}:not(:is(.callout,.callout *,.markdown-embed,.markdown-embed *)){font-size:inherit}`);
	}
	for (const source of rules) {
		const { node, file } = source;
		if (node.type === 'Atrule') {
			const declarations: string[] = [];
			let hasSource = false;
			for (const declaration of node.block?.children ?? []) {
				if (declaration.type !== 'Declaration') continue;
				if (!['font-family', 'src', 'font-style', 'font-weight', 'font-display', 'unicode-range', 'font-stretch'].includes(declaration.property)) { report(file, declaration, 'skipped', `Unsupported font descriptor ${declaration.property}`); continue; }
				const value = rewriteValue(declaration, source, true);
				if (value === null) continue;
				declarations.push(`${declaration.property}:${value}`);
				if (declaration.property === 'src') hasSource = true;
			}
			if (hasSource) { emit(source, `@font-face{${declarations.join(';')}}`); report(file, node, 'mapped', 'Font registration namespaced to this theme'); }
			continue;
		}
		if (node.prelude.type !== 'SelectorList') { report(file, node, 'skipped', 'Unsupported selector syntax'); continue; }
		for (const selector of node.prelude.children) {
			const mapping = selector.type === 'Selector' ? mapSelector(selector) : null;
			if (!mapping) { report(file, selector, 'skipped', `Unsupported or Typora UI selector: ${css.generate(selector)}`); continue; }
			const readDecl: string[] = [];
			const liveDecl: string[] = [];
			const headingTextDecl: string[] = [];
			const heading = /^h[1-6]$/.test(mapping.tag) && !mapping.complex;
			const tokens: string[] = [];
			const metadata = mapping.tag === 'metadata';
			for (const declaration of node.block.children) {
				if (declaration.type !== 'Declaration') { report(file, declaration, 'skipped', 'Nested CSS rule is unsupported'); continue; }
				const property = declaration.property.startsWith('--') ? declaration.property : declaration.property.toLowerCase();
				if (property.startsWith('--paraflow-')) { report(file, declaration, 'skipped', 'ParaFlow editor tokens are reserved; use supported CSS properties'); continue; }
				const value = rewriteValue(declaration, source);
				if (value === null) continue;
				const important = declaration.important ? '!important' : '';
				const pair = `${property}:${value}${important}`;
				if (['background', 'background-color'].includes(property) && !/url\(|gradient\(/u.test(value)) {
					const tableSelector = css.generate(selector).replace(/^#write\s*/u, '');
					const role = /^(?:table\s+)?(?:thead|tfoot)(?:\s+(?:tr\s+)?th)?$/u.test(tableSelector) ? 'header'
						: /^(?:table\s+)?tr:nth-child\((?:2n|even)\)$/u.test(tableSelector) ? 'stripe'
							: tableSelector === 'table' ? 'base' : null;
					if (role) tokens.push(`--paraflow-table-${role}-background:${value}${important}`);
				}
				if (metadata) {
					const metadataToken = ({ 'font-family': 'font', 'font-size': 'size', 'font-weight': 'weight' } as Record<string, string>)[property];
					if (metadataToken) tokens.push(`--paraflow-metadata-${metadataToken}:${value}${important}`);
					else report(file, declaration, 'skipped', 'Metadata container paint and layout are outside the font-only mapping');
					continue;
				}
				if (mapping.marker) {
					const token = property === 'color' ? 'color' : property === 'font-size' ? 'size' : '';
					if (token) {
						const originalValue = css.generate(declaration.value);
						if ((token === 'size' && !/^(?:0*\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(?:\.[0-9]+)?)(?:px|em|rem|%)$/.test(originalValue)) || (token === 'color' && /transparent|^#[0-9a-f]{3}0$|^#[0-9a-f]{6}00$|[,/]0(?:\.0+)?\)$/.test(value))) {
							report(file, declaration, 'skipped', 'Marker visibility requires a positive size and visible color'); continue;
						}
						readDecl.push(pair);
						if (!mapping.complex) tokens.push(`--paraflow-marker-${token}:${value}${important}`);
						else report(file, selector, 'skipped', 'Scoped marker appearance is retained in Reading only', 'live-preview');
					}
					else report(file, declaration, 'skipped', `Unsupported marker property ${property}; marker geometry is protected`);
					continue;
				}
				if (['ul', 'ol', 'li'].includes(mapping.tag) && (blockProperties.has(property) || property.startsWith('list-style') || ['position', 'display', 'transform', 'content'].includes(property))) {
					if (['list-style-type', 'list-style'].includes(property) && ['disc', 'circle', 'square'].includes(value)) {
						readDecl.push(`list-style-type:${value}${important}`);
						if ((!mapping.complex && ['ul', 'li'].includes(mapping.tag)) || css.generate(selector) === 'ul li') tokens.push(`--paraflow-marker-radius:${value === 'square' ? '0' : '50%'}${important}`, `--paraflow-marker-background:${value === 'circle' ? 'transparent' : 'var(--paraflow-marker-color,var(--text-normal))'}${important}`, `--paraflow-marker-border:${value === 'circle' ? '1px solid var(--paraflow-marker-color,var(--text-normal))' : '0'}${important}`);
						else report(file, selector, 'skipped', 'Scoped marker appearance is retained in Reading only', 'live-preview');
					} else report(file, declaration, 'skipped', `List geometry or marker removal rejected: ${property}`);
					continue;
				}
				if (!property.startsWith('--') && !textProperties.has(property) && !paintProperties.has(property) && !blockProperties.has(property)) {
					report(file, declaration, 'skipped', `Unsupported property ${property}`); continue;
				}
				if (mapping.root) {
				if (mapping.rootKind === 'html' && property === 'font-size') continue;
				if (mapping.rootKind === 'write' && ['padding','padding-left','padding-right'].includes(property)) {
					const sides=boxSides(value);
					if (property !== 'padding-right') tokens.push(`--paraflow-page-padding-left:${property==='padding'?sides[3]:lengthValue(value)}${important}`);
					if (property !== 'padding-left') tokens.push(`--paraflow-page-padding-right:${property==='padding'?sides[1]:lengthValue(value)}${important}`);
					continue;
				}
				if (property.startsWith('--') || textProperties.has(property) || ['background', 'background-color', 'background-image'].includes(property)) { readDecl.push(pair); liveDecl.push(pair); }
					else if (property !== 'max-width') { report(file, declaration, 'skipped', `Root layout property ${property} does not map to editor geometry`); continue; }
					for (const token of rootTokens[property] ?? []) tokens.push(`${token}:${value}${important}`);
					if (property === 'background' && !/url\(|gradient\(/.test(value)) tokens.push(`--paraflow-content-background:${value}${important}`, `--background-primary:${value}${important}`);
					continue;
				}
				readDecl.push(pair);
				if (!mapping.complex && (mapping.tag==='p' || mapping.tag==='pre' || heading) && ['margin','margin-top','margin-bottom'].includes(property)) {
					const sides=boxSides(value);
					for (const [side,index] of [['top',0],['bottom',2]] as const) {
						if (property !== 'margin' && property !== `margin-${side}`) continue;
						const raw=property==='margin'?sides[index]!:value;
						const length=lengthValue(raw);
						if (/^auto$|^-\d/u.test(length)) { report(file,declaration,'skipped','Automatic or negative margins have no paragraph gap projection','live-preview'); continue; }
						const projected = heading ? headingRelativeLength(length,mapping.tag) : mapping.tag === 'pre' ? codeRelativeLength(length) : length;
						tokens.push(`--paraflow-${mapping.tag === 'pre' ? 'code-block' : mapping.tag}-margin-${side}:${projected}${important}`);
					}
				}
				if (mapping.tag === 'pre' && (paintProperties.has(property) || blockProperties.has(property))) {
					// Whole-block paint is consumed by the runtime boundary rules, not each editor row.
				} else if (mapping.live.length && (textProperties.has(property) || paintProperties.has(property) || property.startsWith('--') || (heading && ['padding-top','padding-bottom'].includes(property)) || tableTags.has(mapping.tag) || ['img', 'hr'].includes(mapping.tag))) liveDecl.push(pair);
				else if (mapping.live.length) report(file, declaration, 'skipped', `Live Preview ${mapping.tag} layout property ${property} is not transferred`, 'live-preview');
				if (!mapping.complex && (mapping.tag === 'p' || mapping.tag === 'li')) {
					const paragraphToken = ({ 'font-family': 'font', 'font-size': 'size', 'font-weight': 'weight', 'line-height': 'line-height' } as Record<string, string>)[property];
					if (paragraphToken) tokens.push(`--paraflow-${mapping.tag === 'li' ? 'list' : 'paragraph'}-${paragraphToken}:${value}${important}`);
				}
				if (!mapping.complex && mapping.tag === 'footnotes') {
					const token = ({ 'font-size': 'size', 'line-height': 'line-height' } as Record<string,string>)[property];
					if (token) tokens.push(`--paraflow-footnote-${token}:${value}${important}`);
				}
				if (!mapping.complex && ['code', 'pre'].includes(mapping.tag)) {
					const codeToken = ({ color: 'color', background: 'background', 'background-color': 'background', 'font-family': 'font', 'font-size': 'size', 'line-height': 'line-height', border: 'border', padding: 'padding', 'padding-top': 'padding-top', 'padding-bottom': 'padding-bottom', 'padding-left': 'padding-left', 'padding-right': 'padding-right', 'border-radius': 'radius' } as Record<string, string>)[property];
					if (codeToken) tokens.push(`--paraflow-${mapping.tag === 'code' ? 'inline' : 'block'}-code-${codeToken}:${value}${important}`);
					if (mapping.tag === 'pre' && property === 'padding') boxSides(value).forEach((side, index) =>
						tokens.push(`--paraflow-block-code-padding-${['top', 'right', 'bottom', 'left'][index]}:${side}${important}`));
				}
				if (!mapping.complex && mapping.tag === 'a' && property === 'color') tokens.push(`--paraflow-link-color:${value}${important}`);
				if (heading && textProperties.has(property)) headingTextDecl.push(['font-size', 'line-height'].includes(property) ? `${property}:inherit${important}` : pair);
				if (heading && property === 'font-size') tokens.push(`--paraflow-${mapping.tag}-size:${value}${important}`);
			}
			if (readDecl.length) { emit(source, `${reading}${mapping.root ? '' : ` ${mapping.reading}`}{${readDecl.join(';')}}`); mapped++; report(file, selector, 'mapped', 'Reading content rule mapped', 'reading'); }
			if (liveDecl.length) {
				const targets = heading ? mapping.live.slice(0, 1) : mapping.live;
				const selectors = mapping.root ? live : targets.map(target => `${live} ${target}`).join(',');
				emit(source, `${selectors}{${liveDecl.join(';')}}`); report(file, selector, mapping.root ? 'mapped' : 'approximate', 'Live Preview uses Obsidian semantic classes', 'live-preview');
				if (headingTextDecl.length) emit(source, `${live} ${mapping.live[1]}{${headingTextDecl.join(';')}}`);
			} else if (!mapping.root && readDecl.length && !tokens.length) report(file, selector, 'skipped', mapping.tag === 'p' ? 'Paragraph semantic spacing has no Live Preview projection' : 'No equivalent Live Preview selector; Reading mapping retained', 'live-preview');
			if (tokens.length) { emit(source, `${rootSelectors}{${tokens.join(';')}}`); mapped++; if (mapping.marker || ['ul', 'ol', 'li'].includes(mapping.tag)) report(file, selector, 'approximate', 'Marker appearance applied through the shared ParaFlow marker interface'); }
		}
	}
	if (!mapped) throw new Error('Theme contains no usable body/content rules');
	const stylesheet = css.parse(output.join('\n'));
	projectHeadingThemeSelectors(stylesheet);
	projectContentThemeSelectors(stylesheet);
	projectQuoteThemeTokens(stylesheet);
	return {
		manifest: { schemaVersion: 1, id: options.id, name: options.name, origin: 'imported', colorScheme, converterVersion: CONVERTER_VERSION, sourceEntry: input.entry, ...(options.sourceVersion ? { sourceVersion: options.sourceVersion } : {}) },
		css: css.generate(stylesheet), assets, sources: files, diagnostics,
	};
}
