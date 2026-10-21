import * as css from 'css-tree';

/** CSS identifiers keep their escapes in css-tree's AST. */
export function cssName(name: string): string {
	return css.ident.decode(name).toLowerCase();
}

type ThemeResource = { kind: 'import' } | { kind: 'unsupported-function'; name: string } | css.Url;

export function themeResource(node: css.CssNode): ThemeResource | null {
	if (node.type === 'Atrule' && cssName(node.name) === 'import') return { kind: 'import' };
	if (node.type === 'Url') return node;
	if (node.type !== 'Function') return null;
	const name = cssName(node.name);
	// Only Url nodes have the package-path representation our resource mapper supports.
	if (['image-set', '-webkit-image-set', 'image', 'src', 'url'].includes(name)) return { kind: 'unsupported-function', name };
	return null;
}
