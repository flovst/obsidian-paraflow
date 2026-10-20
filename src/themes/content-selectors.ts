import * as css from 'css-tree';
import { tableTags } from './css-mapping.js';

const inlineTargets: Record<string, string> = {
	a: ':is(a,.cm-link,.cm-url,.cm-link .cm-underline)',
	mark: ':is(mark,.cm-highlight,.paraflow-inline-body--highlight)',
	code: ':is(code,.cm-inline-code,.paraflow-inline-body--inline-code)',
	strong: ':is(strong,.cm-strong,.paraflow-inline-body--strong,.paraflow-inline-body--strong-emphasis)',
	b: ':is(b,.cm-strong,.paraflow-inline-body--strong,.paraflow-inline-body--strong-emphasis)',
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

/** Text inside rendered diagrams has its own measured typography. */
export function isolateDiagramParagraphs(ast: css.CssNode): void {
	css.walk(ast, node => {
		if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;
		for (const selector of node.prelude.children) {
			if (selector.type !== 'Selector') continue;
			const parts = selector.children.toArray();
			if (!parts.some(part => part.type === 'ClassSelector' && part.name === 'markdown-reading-view')) continue;
			const target = parts.slice(parts.findLastIndex(part => part.type === 'Combinator') + 1);
			const paragraph = target.some(part => {
				if (part.type === 'TypeSelector') return part.name === 'p';
				if (part.type !== 'PseudoClassSelector' || !['is', 'where'].includes(part.name)) return false;
				let includesParagraph = false;
				css.walk(part, child => { if (child.type === 'TypeSelector' && child.name === 'p') includesParagraph = true; });
				return includesParagraph;
			});
			if (!paragraph || css.generate(selector).includes(':not(.mermaid *)')) continue;
			const exclusion = css.parse(':where(:not(.mermaid *))', { context: 'selector' }) as css.Selector;
			selector.children.appendData(exclusion.children.first!);
		}
	});
}

/** An explicit appearance accent overrides contextual theme links, including table links. */
export function projectLinkAccentOverride(ast: css.CssNode): void {
	const additions: Array<{list: css.List<css.CssNode>; item: css.ListItem<css.CssNode>; rule: css.Rule}> = [];
	css.walk(ast, (node, item, list) => {
		if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList' || !item || !list) return;
		const selectors = node.prelude.children.toArray().filter(selector => {
			if (selector.type !== 'Selector') return false;
			const parts = selector.children.toArray();
			if (!parts.some(part => part.type === 'ClassSelector' && ['markdown-reading-view', 'is-live-preview'].includes(part.name))) return false;
			let link = false;
			for (const part of parts.slice(parts.findLastIndex(part => part.type === 'Combinator') + 1)) css.walk(part, child => {
				if ((child.type === 'TypeSelector' && child.name === 'a') ||
					(child.type === 'ClassSelector' && ['cm-link', 'cm-url', 'cm-underline'].includes(child.name))) link = true;
			});
			return link;
		});
		const colors = node.block.children.toArray().filter((part): part is css.Declaration => part.type === 'Declaration' && part.property.toLowerCase() === 'color');
		if (!selectors.length || !colors.length || colors.every(color => css.generate(color.value).includes('--paraflow-link-override'))) return;
		// Keep the authored fallback order and per-declaration priority, including repeated colors.
		const declarations = colors.map(color => {
			const original = css.generate(color.value);
			const value = original.includes('--paraflow-link-override') ? original : `var(--paraflow-link-override,${original})`;
			return `color:${value}${color.important ? '!important' : ''}`;
		}).join(';');
		const rule = css.parse(`${selectors.map(selector => css.generate(selector)).join(',')}{${declarations}}`) as css.StyleSheet;
		additions.push({list,item,rule:rule.children.first as css.Rule});
	});
	for (const {list,item,rule} of additions) {
		if (item.next && css.generate(item.next.data) === css.generate(rule)) continue;
		if (item.next) list.insertData(rule,item.next); else list.appendData(rule);
	}
}
