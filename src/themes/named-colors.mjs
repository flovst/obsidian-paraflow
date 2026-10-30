import { lexer, walk } from 'css-tree';

// Named colors present in bundled themes and MathJax's generated SVG stylesheet.
const palette = new Map([
	['black', '000'], ['white', 'fff'], ['blue', '00f'], ['red', 'f00'], ['yellow', 'ff0'],
]);

// Typora UI foreground tokens have color semantics in imported packages.
const typoraForegroundTokens = new Set(['--active-file-text-color', '--select-text-font-color', '--item-hover-text-color']);

/** @param {string} property @param {import('css-tree').CssNode} value */
export function normalizeTyporaForegroundToken(property, value) {
	if (typoraForegroundTokens.has(property)) normalizeNamedColors('color', value);
}

/**
 * Canonicalize proven color tokens; custom properties retain their untyped token stream.
 * @param {string} property
 * @param {import('css-tree').CssNode} value
 */
export function normalizeNamedColors(property, value) {
	if (property.startsWith('--')) return;
	// css-tree 3 exposes trace methods missing from its current external type package.
	const match = /** @type {import('css-tree').LexerMatchResult & { isType(node: import('css-tree').CssNode, type: string): boolean }} */ (lexer.matchProperty(property, value));
	if (match.error) return;
	walk(value, node => {
		if (node.type !== 'Identifier' || !match.isType(node, 'color')) return;
		const hex = palette.get(node.name.toLowerCase());
		if (!hex) return;
		Object.assign(node, { type: 'Hash', value: hex });
		delete node.name;
	});
}
