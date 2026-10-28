const ownership = new WeakMap<HTMLElement, { count: number; added: boolean; hadClassAttribute: boolean; tailAdded: boolean; previousStyle: string | null }>();

function endsInList(element: HTMLElement): boolean {
	let current: Element | null=element;
	while(current) {
		if(current.matches('ul,ol'))return true;
		if(current.matches('.callout')) {
			if(current.classList.contains('is-collapsed'))return false;
			current=current.querySelector(':scope > .callout-content');
		}else if(!current.matches('blockquote,.callout-content'))return false;
		current=current?.lastElementChild ?? null;
	}
	return false;
}

/** Reading and native PDF roots may overlap; each registration releases only its own ownership. */
export function enhanceReadingQuotes(root: HTMLElement, style: 'default' | 'obsidian' = 'default'): () => void {
	const elements = [...(root.matches('.callout, blockquote') ? [root] : []), ...root.querySelectorAll<HTMLElement>('.callout, blockquote')]
		.filter(element => !element.closest('.paraflow-callout-title'));
	for (const element of elements) {
		const token = element.matches('.callout') ? 'paraflow-display-callout' : 'paraflow-display-quote';
		const previous = ownership.get(element);
		if (previous) previous.count += 1;
		else {
			ownership.set(element, { count: 1, added: !element.classList.contains(token), hadClassAttribute: element.hasAttribute('class'), tailAdded: false, previousStyle: element.getAttribute('data-paraflow-callout-style') });
			element.classList.add(token);
		}
		if (element.matches('.callout')) element.dataset.paraflowCalloutStyle = style;
		const entry=ownership.get(element)!;
		const tail=element.matches('.callout')&&endsInList(element);
		if(tail&&!element.classList.contains('paraflow-callout-list-tail')) {element.classList.add('paraflow-callout-list-tail');entry.tailAdded=true;}
		else if(!tail&&entry.tailAdded) {element.classList.remove('paraflow-callout-list-tail');entry.tailAdded=false;}
	}
	return () => {
		for (const element of elements) {
			const entry = ownership.get(element)!;
			if (--entry.count > 0) continue;
			if (entry.added) element.classList.remove(element.matches('.callout') ? 'paraflow-display-callout' : 'paraflow-display-quote');
			if (entry.tailAdded) element.classList.remove('paraflow-callout-list-tail');
			if (entry.previousStyle === null) element.removeAttribute('data-paraflow-callout-style');
			else element.setAttribute('data-paraflow-callout-style', entry.previousStyle);
			if (!entry.hadClassAttribute && element.classList.length === 0) element.removeAttribute('class');
			ownership.delete(element);
		}
	};
}
