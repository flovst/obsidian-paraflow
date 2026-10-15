import * as css from 'css-tree';

const widthTokens = ['--paraflow-content-width', '--paraflow-text-width', '--paraflow-page-padding-left', '--paraflow-page-padding-right'];
const textProperties = new Set(['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'caret-color']);
const sourceToken = (property: string): boolean =>
 /^(?:--font-text(?:-size)?|--text-(?:normal|muted|faint|accent)|--interactive-accent|--link-(?:color|external-color)|--code-(?:normal|comment|keyword|string|number|function|property)|--background-(?:primary|secondary)|--paraflow-(?:content-(?:font|font-size|color|background|weight|line-height)|paragraph-(?:font|size|weight|line-height)|h[1-6]-(?:size|font|weight|color)|link-color))$/u.test(property);

/** Project Source text and width in place, retaining cascade without live layout or hidden syntax. */
export function projectSourceThemeTokens(ast: css.CssNode): void {
 const rules: Array<{rule: css.Rule; list: css.List<css.CssNode>; item: css.ListItem<css.CssNode>; selectors: string[]; heading: boolean}> = [];
 css.walk(ast, function(node, item, list) {
  if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList' || !item || !list) return;
  const roots: string[] = [], headings: string[] = [];
  for (const selector of node.prelude.children) {
   if (selector.type !== 'Selector') continue;
   const parts = selector.children.toArray();
   const live = parts.findIndex(part => part.type === 'ClassSelector' && part.name === 'is-live-preview');
   if (live < 0) continue;
   const heading = parts.findIndex(part => part.type === 'ClassSelector' && /^(?:HyperMD-header|cm-header)-[1-6]$/u.test(part.name));
   const projected = css.generate(selector).replace('.is-live-preview', ':not(.is-live-preview)');
   if (!parts.slice(live + 1).some(part => part.type === 'Combinator')) roots.push(projected);
   else if (heading > live && !parts.slice(heading + 1).some(part => part.type === 'Combinator')) headings.push(`${projected}:not(.cm-table-widget *)`);
  }
  if (roots.length) rules.push({rule:node,item,list,selectors:roots,heading:false});
  if (headings.length) rules.push({rule:node,item,list,selectors:headings,heading:true});
 });
 const required = new Set(widthTokens);
 const appearance = new Set<string>();
 for (const {rule,heading} of rules) for (const declaration of rule.block.children) {
  if (declaration.type !== 'Declaration') continue;
  if (textProperties.has(declaration.property) || (!heading && (sourceToken(declaration.property) || declaration.property === 'background-color'))) appearance.add(declaration.property);
 }
 const dependencies = (set: Set<string>, width: boolean): void => {
  for (let previous = -1; previous !== set.size;) {
   previous = set.size;
   for (const {rule} of rules) for (const declaration of rule.block.children) {
    if (declaration.type !== 'Declaration' || !set.has(declaration.property)) continue;
    css.walk(declaration.value, node => {
     if (width && node.type === 'Dimension' && node.unit === 'em') set.add('--font-text-size');
     if (node.type === 'Function' && node.name === 'var' && node.children.first?.type === 'Identifier') set.add(node.children.first.name);
    });
   }
  }
 };
 dependencies(required, true);
 dependencies(appearance, false);
 const fontDependencies = new Set(['--font-text-size']);
 dependencies(fontDependencies, false);
 for (const {rule,item,list,selectors,heading} of rules) {
  const declarations = rule.block.children.toArray().filter(node => node.type === 'Declaration' &&
   (heading ? textProperties.has(node.property) : required.has(node.property) || appearance.has(node.property)));
  if (!declarations.length) continue;
  const projected = css.clone(rule) as css.Rule;
  projected.prelude = css.parse(selectors.join(','), {context:'selectorList'}) as css.SelectorList;
  projected.block.children = new css.List<css.CssNode>();
  for (const node of declarations) {
   const declaration = css.clone(node) as css.Declaration;
   if (!heading && required.has(declaration.property)) {
    if (declaration.property === '--font-text-size') {
     projected.block.children.appendData(css.clone(declaration));
     declaration.property = '--paraflow-width-font-size';
    }
    const fontDependency = fontDependencies.has(node.type === 'Declaration' ? node.property : '');
    css.walk(declaration.value, value => {
     if (value.type === 'Identifier' && value.name === '--font-text-size') value.name = '--paraflow-width-font-size';
     if (!fontDependency && value.type === 'Dimension' && value.unit === 'em') {
      const replacement = css.parse(`calc(${value.value} * var(--paraflow-width-font-size))`, {context:'value'}) as css.Value;
      Object.assign(value, replacement.children.first);
     }
    });
   }
   projected.block.children.appendData(declaration);
  }
  if (item.next && css.generate(item.next.data) === css.generate(projected)) continue;
  if (item.next) list.insertData(projected, item.next);
  else list.appendData(projected);
 }
}
