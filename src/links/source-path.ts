/** Embedded Markdown keeps its linktext in `src`; each nested embed resolves against its renderer's source. */
export function renderedLinkSourcePath(target: Element, surface: HTMLElement, sourcePath: string,
	parse: (destination: string) => { path: string }, resolve: (path: string, sourcePath: string) => { path: string } | null): string | null {
	const embeds: Element[] = [];
	for (let current: Element | null = target; current && current !== surface; current = current.parentElement) {
		if (current.matches('.internal-embed[src]')) embeds.unshift(current);
	}
	for (const embed of embeds) {
		const path = parse(embed.getAttribute('src')!).path;
		const file = resolve(path || sourcePath, sourcePath);
		if (!file) return null;
		sourcePath = file.path;
	}
	return sourcePath;
}
