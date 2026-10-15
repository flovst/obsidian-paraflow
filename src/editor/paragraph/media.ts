import type { SyntaxNode } from '@lezer/common';
import { parser, Strikethrough } from '@lezer/markdown';

const mediaParser = parser.configure(Strikethrough);
const imageExtension = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/iu;

/** Unknown wiki embeds remain native-owned even when their paragraph has no text. */
export function standaloneMediaKind(source: string): 'image' | 'embed' | null {
	if (!source.includes('![') && !/<img\b/iu.test(source)) return null;
	const paragraph = mediaParser.parse(source).topNode.firstChild;
	if (paragraph?.name !== 'Paragraph') return null;
	let hasImage = false;
	let hasEmbed = false;
	function hasText(node: SyntaxNode): boolean {
		if (node.name === 'Image') {
			const wiki = /^!\[\[([^\]\n]+)\]\]$/u.exec(source.slice(node.from, node.to));
			if (wiki && !imageExtension.test(wiki[1]!.split('|')[0]!.split('#')[0]!)) hasEmbed = true;
			else hasImage = true;
			return false;
		}
		if (node.name === 'HTMLTag') {
			const tag = /^<\/?([a-z][a-z\d]*)\b/iu.exec(source.slice(node.from, node.to))?.[1]?.toLowerCase();
			if (tag === 'img') { hasImage = true; return false; }
			return !tag || !['a', 'span', 'strong', 'em', 'b', 'i', 's', 'del', 'ins', 'u', 'mark', 'small', 'sub', 'sup'].includes(tag);
		}
		if (!['Paragraph', 'Emphasis', 'StrongEmphasis', 'Strikethrough', 'Link'].includes(node.name)) return true;
		let cursor = node.from;
		for (let child = node.firstChild; child; child = child.nextSibling) {
			if (source.slice(cursor, child.from).trim()) return true;
			const syntax = ['EmphasisMark', 'StrikethroughMark', 'LinkMark'].includes(child.name) ||
				(node.name === 'Link' && ['URL', 'LinkTitle', 'LinkLabel'].includes(child.name));
			if (!syntax && hasText(child)) return true;
			cursor = child.to;
		}
		return source.slice(cursor, node.to).trim().length > 0;
	}
	if (hasText(paragraph)) return null;
	return hasEmbed ? 'embed' : hasImage ? 'image' : null;
}
