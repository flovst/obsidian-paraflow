import { hasMermaidContentTheme, mermaidBodies, mermaidThemeSource, type MermaidThemeRenderer } from '../display/mermaid-theme.js';

interface Owner {
	count: number; added: boolean; hadClass: boolean;
	baseline: Node[] | null; paint: Node[] | null; source: string | null; generation: object | null;
}
const owners = new WeakMap<HTMLElement, Owner>();

/** Reading, section and export render registrations can share the same diagram. */
export function enhanceReadingMermaid(root: HTMLElement, source: string | null = null, render?: MermaidThemeRenderer): () => void {
	const diagrams = [...(root.matches('.mermaid') ? [root] : []), ...root.querySelectorAll<HTMLElement>('.mermaid')]
		.filter(element => !element.closest('.markdown-embed'));
	const bodies = source === null ? [] : mermaidBodies(source);
	for (const [index, diagram] of diagrams.entries()) {
		let owned = owners.get(diagram);
		if (owned) { owned.count++; if (owned.added) diagram.classList.add('paraflow-reading-mermaid'); }
		else {
			owned = { count: 1, added: !diagram.classList.contains('paraflow-reading-mermaid'), hadClass: diagram.hasAttribute('class'), baseline: null, paint: null, source: null, generation: null };
			owners.set(diagram, owned);
			diagram.classList.add('paraflow-reading-mermaid');
		}
		if (!render || bodies.length !== diagrams.length || !diagram.querySelector('svg')) continue;
		diagram.classList.toggle('paraflow-mermaid-themed', hasMermaidContentTheme(diagram));
		if (owned.paint && (diagram.childNodes.length !== owned.paint.length || owned.paint.some((node, index) => diagram.childNodes[index] !== node))) {
			owned.baseline = [...diagram.childNodes]; owned.paint = null; owned.source = null; owned.generation = null;
		}
		const body = bodies[index]!;
		const themed = mermaidThemeSource(body, diagram);
		if (themed === body) {
			owned.generation = null; owned.source = null;
			if (owned.baseline) { diagram.replaceChildren(...owned.baseline); owned.baseline = null; owned.paint = null; }
			continue;
		}
		if (owned.source === themed) continue;
		owned.baseline ??= [...diagram.childNodes];
		owned.source = themed;
		const generation = owned.generation = {};
		const owner = owned;
		void render(themed, diagram.ownerDocument).then(result => {
			if (owners.get(diagram) !== owner || owner.generation !== generation || owner.count === 0) return;
			owner.paint = [...result.content.childNodes];
			diagram.replaceChildren(result.content);
			result.bindFunctions?.(diagram);
		}, error => {
			if (owner.generation === generation) console.error('ParaFlow Mermaid theme rendering failed', error);
		});
	}
	return () => {
		for (const diagram of diagrams) {
			const owned = owners.get(diagram)!;
			if (--owned.count) continue;
			diagram.classList.remove('paraflow-mermaid-themed');
			if (owned.added) diagram.classList.remove('paraflow-reading-mermaid');
			if (!owned.hadClass && !diagram.classList.length) diagram.removeAttribute('class');
			// Root refresh releases and reacquires synchronously. Retain the SVG and
			// its source association through that cycle; final release restores native DOM.
			queueMicrotask(() => {
				if (owned.count || owners.get(diagram) !== owned) return;
				owned.generation = null;
				if (owned.baseline) diagram.replaceChildren(...owned.baseline);
				owners.delete(diagram);
			});
		}
	};
}
