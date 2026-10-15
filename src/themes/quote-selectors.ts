import * as css from 'css-tree';

const length = (value: string): string => value === '0' ? '0px' :
	({ thin: '1px', medium: '3px', thick: '5px' }[value] ?? value).replace(/([\d.]+)em\b/gu, 'calc($1 * var(--font-text-size))');
const leftSide = (value: css.CssNode): string => {
	const parts = value.type === 'Value' ? value.children.toArray().map(part => css.generate(part)) : [css.generate(value)];
	return length(parts[3] ?? parts[1] ?? parts[0]!);
};

/** Saved packages and fresh imports share quote metrics, including conditional rules. */
export function projectQuoteThemeTokens(ast: css.CssNode): void {
	const rules: Array<{ rule: css.Rule; list: css.List<css.CssNode>; item: css.ListItem<css.CssNode>; roots: string[] }> = [];
	css.walk(ast, (node, item, list) => {
		if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList' || !item || !list) return;
		const roots = new Set<string>();
		for (const selector of node.prelude.children) {
			if (selector.type !== 'Selector') continue;
			const parts = selector.children.toArray();
			const reading = parts.findIndex(part => part.type === 'ClassSelector' && part.name === 'markdown-reading-view');
			const tail = parts.slice(reading + 1);
			if (reading < 0 || tail[0]?.type !== 'Combinator' || tail[1]?.type !== 'TypeSelector' || tail[1].name !== 'blockquote' ||
				tail.slice(2).some(part => part.type !== 'PseudoClassSelector' || part.name !== 'not')) continue;
			const prefix = parts.slice(0, reading).map(part => css.generate(part)).join('');
			roots.add(`${prefix}.markdown-reading-view`);
			roots.add(`${prefix}.markdown-source-view.mod-cm6.is-live-preview:not(:is(.cm-table-widget *))`);
		}
		if (roots.size) rules.push({ rule: node, item, list, roots: [...roots] });
	});
	for (const { rule, item, list, roots } of rules) {
		const declarations: string[] = [];
		for (const declaration of rule.block.children) {
			if (declaration.type !== 'Declaration') continue;
			const property = declaration.property, value = css.generate(declaration.value);
			const emit = (name: string, tokenValue: string): void => { declarations.push(`--paraflow-quote-${name}:${tokenValue}${declaration.important ? '!important' : ''}`); };
			if (['padding-left', 'padding-inline-start'].includes(property)) emit('padding-left', length(value));
			else if (property === 'padding') emit('padding-left', leftSide(declaration.value));
			else if (property === 'padding-inline' && declaration.value.type === 'Value') emit('padding-left', length(css.generate(declaration.value.children.first!)));
			else if (['border-left-width', 'border-inline-start-width'].includes(property)) emit('border-width', length(value));
			else if (property === 'border-width') emit('border-width', leftSide(declaration.value));
			else if (['border-left-color', 'border-inline-start-color'].includes(property)) emit('border', value);
			else if (property === 'border-color') emit('border', leftSide(declaration.value));
			else if (['border', 'border-left', 'border-inline-start'].includes(property) && declaration.value.type === 'Value') {
				const parts = declaration.value.children.toArray();
				const width = parts.find(part => !css.lexer.matchType('line-width', part).error);
				const color = parts.find(part => !css.lexer.matchType('color', part).error);
				emit('border-width', width ? length(css.generate(width)) : '3px');
				emit('border', color ? css.generate(color) : 'currentColor');
			} else if (property === 'color') emit('text', value);
			else if (property === 'font-style') emit('font-style', value);
		}
		if (!declarations.length) continue;
		const projected = css.parse(`${roots.join(',')}{${declarations.join(';')}}`, { parseCustomProperty: true }) as css.StyleSheet;
		const next = projected.children.first!;
		if (item.next && css.generate(item.next.data) === css.generate(next)) continue;
		if (item.next) list.insertData(next, item.next); else list.appendData(next);
	}
}
