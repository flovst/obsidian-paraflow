import * as css from 'css-tree';
import { contentExclusion } from './css-mapping.js';

/** Give owned headings the exact theme declarations already used by native headings. */
export function projectHeadingThemeSelectors(ast: css.CssNode): void {
	css.walk(ast, node => {
		if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;
		const selectors = node.prelude.children;
		const existing = new Set(selectors.toArray().map(selector => css.generate(selector)));
		let ownsLine = false;
		for (const selector of selectors.toArray()) {
			if (selector.type !== 'Selector') continue;
			const parts = selector.children.toArray();
			if (!parts.some(part => part.type === 'ClassSelector' && part.name === 'is-live-preview')) continue;
			if (parts.some(part => part.type === 'ClassSelector' && /^paraflow-heading-line--h[1-6]$/u.test(part.name))) continue;
			const index = parts.findIndex(part => part.type === 'ClassSelector' && /^(?:HyperMD-header|cm-header)-[1-6]$/u.test(part.name));
			if (index < 0 || parts.slice(index + 1).some(part => part.type === 'Combinator')) continue;
			const heading = parts[index] as css.ClassSelector;
			if (heading.name.startsWith('HyperMD-')) ownsLine = true;
			const owner: css.ClassSelector = { type: 'ClassSelector', name: `paraflow-heading-line--h${heading.name.at(-1)!}` };
			const projected = parts.flatMap((part, position): css.CssNode[] => {
				if (position === index) return heading.name.startsWith('HyperMD-')
					? [owner]
					: [owner, { type: 'Combinator', name: ' ' },
						...(css.parse(':where(.paraflow-heading-body)', { context: 'selector' }) as css.Selector).children.toArray()];
				if (position > index && css.generate(part) === contentExclusion) {
					return (css.parse(':not(:is(.markdown-embed,.markdown-embed *))', { context: 'selector' }) as css.Selector).children.toArray();
				}
				return [part];
			});
			const owned: css.Selector = { type: 'Selector', children: new css.List<css.CssNode>().fromArray(projected) };
			const text = css.generate(owned);
			if (!existing.has(text)) { selectors.appendData(owned); existing.add(text); }
		}
		if (ownsLine && !node.block.children.some(part => part.type === 'Declaration' && part.property === '--paraflow-heading-padding-bottom')) {
			for (const declaration of node.block.children.toArray()) {
				if (declaration.type !== 'Declaration' || declaration.property !== 'padding-bottom') continue;
				const padding = css.clone(declaration) as css.Declaration; padding.property = '--paraflow-heading-padding-bottom';
				node.block.children.appendData(padding);
			}
		}
	});
}
