import * as css from 'css-tree';
import { tableTags } from './css-mapping.js';

const inlineTargets: Record<string, string> = {
	a: ':is(a,.cm-link,.cm-url,.cm-link .cm-underline)',
	mark: ':is(mark,.cm-highlight,.paraflow-inline-body--highlight)',
	code: ':is(code,.cm-inline-code,.paraflow-inline-body--inline-code)',
	strong: ':is(strong,.cm-strong,.paraflow-inline-body--strong)',
	b: ':is(b,.cm-strong,.paraflow-inline-body--strong)',
	em: ':is(em,.cm-em,.paraflow-inline-body--emphasis)',
	i: ':is(i,.cm-em,.paraflow-inline-body--emphasis)',
};
const nativeInline: Record<string, string> = { 'cm-highlight': 'mark', 'cm-inline-code': 'code', 'cm-strong': 'strong', 'cm-em': 'em' };
const inlineTokens: Record<string, Record<string, string>> = {
	mark: { background: 'highlight-background', 'background-color': 'highlight-background', color: 'highlight-color' },
	code: { background: 'inline-code-background', 'background-color': 'inline-code-background', color: 'inline-code-color', border: 'inline-code-border', 'border-radius': 'inline-code-radius', padding: 'inline-code-padding', 'font-size': 'inline-code-size', 'font-family': 'inline-code-font' },
	strong: { 'font-weight': 'strong-weight' }, b: { 'font-weight': 'strong-weight' },
	em: { 'font-style': 'emphasis-style' }, i: { 'font-style': 'emphasis-style' },
};

/** Project semantic paint at activation, including packages saved by older converters. */
export function projectContentThemeSelectors(ast: css.CssNode): void {
	css.walk(ast, node => {
		if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;
		const selectors = node.prelude.children;
		const existing = new Set(selectors.toArray().map(selector => css.generate(selector)));
		const kinds = new Set<string>();
		for (const selector of selectors.toArray()) {
			if (selector.type !== 'Selector') continue;
			const parts = selector.children.toArray();
			const reading = parts.findIndex(part => part.type === 'ClassSelector' && part.name === 'markdown-reading-view');
			const live = parts.some(part => part.type === 'ClassSelector' && part.name === 'is-live-preview');
			let projected: string | undefined;
			if (reading >= 0) {
				const tail = parts.slice(reading + 1);
				const index = tail.findLastIndex(part => part.type === 'TypeSelector');
				const target = tail[index];
				// Native HTML and cell editors share table descendants, but arbitrary layout chains do not.
				if (target?.type !== 'TypeSelector' || !inlineTargets[target.name] ||
					tail.slice(0, index).some(part => part.type !== 'Combinator' && !(part.type === 'TypeSelector' && tableTags.has(part.name))) ||
					tail.slice(index + 1).some(part => part.type !== 'PseudoClassSelector')) continue;
				kinds.add(target.name);
				projected = parts.slice(0, reading).map(part => css.generate(part)).join('') +
					'.markdown-source-view.mod-cm6.is-live-preview:not(:is(.cm-table-widget *))' +
					tail.map((part, position) => position === index ? inlineTargets[target.name] : css.generate(part)).join('');
			} else if (live) {
				const index = parts.findIndex(part => part.type === 'ClassSelector' && nativeInline[part.name]);
				const target = parts[index];
				if (target?.type !== 'ClassSelector' || parts.slice(index + 1).some(part => part.type === 'Combinator')) continue;
				const kind = nativeInline[target.name]!;
				kinds.add(kind);
				projected = parts.map((part, position) => position === index ? inlineTargets[kind] : css.generate(part)).join('');
			}
			if (projected && !existing.has(projected)) {
				selectors.appendData(css.parse(projected, { context: 'selector' }));
				existing.add(projected);
			}
		}
		const declarations = node.block.children.toArray().filter((part): part is css.Declaration => part.type === 'Declaration');
		const properties = new Set(declarations.map(part => part.property));
		for (const kind of kinds) for (const declaration of declarations) {
			const token = inlineTokens[kind]?.[declaration.property];
			if (!token || properties.has(`--paraflow-${token}`)) continue;
			if (css.generate(declaration.value).includes(`var(--paraflow-${token}`)) continue;
			const projected = css.clone(declaration) as css.Declaration;
			projected.property = `--paraflow-${token}`;
			node.block.children.appendData(projected);
		}
		// Older uniform-marker packages predate the shared size token.
		if (!properties.has('--paraflow-marker-size') && properties.has('--paraflow-marker-radius') &&
			properties.has('--paraflow-marker-background') && properties.has('--paraflow-marker-border')) {
			const background = declarations.find(part => part.property === '--paraflow-marker-background')!;
			const value = css.generate(background.value);
			const size = value === 'initial' ? 'initial' : value === 'transparent' ? '0.4375em' : '0.375em';
			node.block.children.appendData(css.parse(`--paraflow-marker-size:${size}${background.important ? '!important' : ''}`, { context: 'declaration' }));
		}
	});
}
