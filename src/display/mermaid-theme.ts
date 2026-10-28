import { parser } from '@lezer/markdown';

export interface MermaidThemeResult { content: DocumentFragment; bindFunctions?: (element: HTMLElement) => void }
export type MermaidThemeRenderer = (source: string, owner?: Document) => Promise<MermaidThemeResult>;

export function hasMermaidContentTheme(surface: HTMLElement): boolean {
	return /^(?:light|dark)$/u.test(surface.ownerDocument.defaultView!.getComputedStyle(surface).getPropertyValue('--paraflow-color-scheme').trim());
}

/** Diagram configuration stays local to the rendered copy of the source. */
export function mermaidThemeSource(source: string, surface: HTMLElement): string {
	const scheme = surface.ownerDocument.defaultView!.getComputedStyle(surface).getPropertyValue('--paraflow-color-scheme').trim();
	if (scheme !== 'dark' && scheme !== 'light') return source;
	const frontmatter = /^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(source);
	const directives = [...source.matchAll(/%%\{\s*(?:init|initialize)\s*:[\s\S]*?\}%%/gu)].map(match => match[0]).join('\n');
	if (/\b(?:theme|themeVariables|themeCSS)\s*["']?\s*:/u.test((frontmatter?.[0] ?? '') + directives)) return source;
	const at = frontmatter?.[0].length ?? 0;
	return source.slice(0, at) + `%%{init: {"theme":"${scheme === 'dark' ? 'dark' : 'default'}"}}%%\n` + source.slice(at);
}

export function mermaidMarkdownTheme(source: string, surface: HTMLElement): string {
	const firstLine = source.indexOf('\n');
	return firstLine < 0 ? source : source.slice(0, firstLine + 1) + mermaidThemeSource(source.slice(firstLine + 1), surface);
}

/** Match diagram order in a rendered Markdown section, including quoted fences. */
export function mermaidBodies(source: string): string[] {
	const bodies: string[] = [];
	parser.parse(source).iterate({ enter(node) {
		if (node.name !== 'FencedCode') return;
		const info = node.node.getChild('CodeInfo');
		if (!info || source.slice(info.from, info.to).trim().toLowerCase() !== 'mermaid') return false;
		const content = node.node.getChildren('CodeText');
		bodies.push(content.map(text => source.slice(text.from, text.to)).join(''));
		return false;
	} });
	return bodies;
}
