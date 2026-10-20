const owners = new WeakMap<HTMLElement, { count: number; added: boolean; hadClass: boolean }>();

/** Reading, section and export render registrations can share the same diagram. */
export function enhanceReadingMermaid(root: HTMLElement): () => void {
	const diagrams = [...(root.matches('.mermaid') ? [root] : []), ...root.querySelectorAll<HTMLElement>('.mermaid')]
		.filter(element => !element.closest('.markdown-embed'));
	for (const diagram of diagrams) {
		const owned = owners.get(diagram);
		if (owned) owned.count++;
		else {
			owners.set(diagram, { count: 1, added: !diagram.classList.contains('paraflow-reading-mermaid'), hadClass: diagram.hasAttribute('class') });
			diagram.classList.add('paraflow-reading-mermaid');
		}
	}
	return () => {
		for (const diagram of diagrams) {
			const owned = owners.get(diagram)!;
			if (--owned.count) continue;
			if (owned.added) diagram.classList.remove('paraflow-reading-mermaid');
			if (!owned.hadClass && !diagram.classList.length) diagram.removeAttribute('class');
			owners.delete(diagram);
		}
	};
}
