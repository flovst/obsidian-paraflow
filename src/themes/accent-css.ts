import * as css from 'css-tree';

/** Expose the content accent palette to settings without content layout or paint. */
export function themeAccentCss(source: string): string {
	const ast = css.parse(source, { parseCustomProperty: true });
	const rules = new Map<css.Rule, string[]>();
	css.walk(ast, node => {
		if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;
		const selectors: string[] = [];
		for (const selector of node.prelude.children) {
			if (selector.type !== 'Selector') continue;
			const parts = selector.children.toArray();
			const reading = parts.findIndex(part => part.type === 'ClassSelector' && part.name === 'markdown-reading-view');
			const body = parts.findIndex(part => part.type === 'TypeSelector' && part.name === 'body');
			if (body < 0 || (reading < 0 && parts.some(part => part.type === 'Combinator'))) continue;
			if (reading >= 0 && parts.slice(reading + 1).some(part => part.type === 'Combinator')) continue;
			const prefix = (reading < 0 ? parts : parts.slice(0, reading)).filter(part =>
				part.type !== 'AttributeSelector' || part.name.name !== 'data-paraflow-theme');
			selectors.push(prefix.map(part => css.generate(part)).join('') + (reading < 0 ? ' ' : '') + '.paraflow-accent-theme');
		}
		if (selectors.length) rules.set(node, [...new Set(selectors)]);
	});
	const required = new Set(['--paraflow-link-color']);
	// Host accent is inherited from the settings window, outside the content bridge.
	const hostTokens = new Set(['--paraflow-host-accent', '--interactive-accent']);
	for (let size = -1; size !== required.size;) {
		size = required.size;
		for (const rule of rules.keys()) for (const declaration of rule.block.children) {
			if (declaration.type !== 'Declaration' || !required.has(declaration.property)) continue;
			css.walk(declaration.value, value => {
				if (value.type === 'Function' && value.name === 'var' && value.children.first?.type === 'Identifier' &&
					!hostTokens.has(value.children.first.name)) required.add(value.children.first.name);
			});
		}
	}
	css.walk(ast, { leave(node: css.CssNode, item: css.ListItem<css.CssNode>, list: css.List<css.CssNode>) {
		if (!item || !list) return;
		if (node.type === 'Rule') {
			const selectors = rules.get(node);
			const declarations = node.block.children.toArray().filter(value => value.type === 'Declaration' && required.has(value.property));
			if (!selectors || !declarations.length) { list.remove(item); return; }
			node.prelude = css.parse(selectors.join(','), { context: 'selectorList' }) as css.SelectorList;
			node.block.children.fromArray(declarations);
		} else if (node.type === 'Atrule' && (!['media', 'supports', 'layer', 'container'].includes(node.name) || node.block?.children.isEmpty)) list.remove(item);
	} });
	return css.generate(ast);
}
