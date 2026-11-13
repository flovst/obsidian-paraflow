/** Project the list structure already visited by the Reading section owner. */
export function projectReadingListClasses(root: HTMLElement, owns: (element: Element) => boolean): () => void {
	const restore: Array<() => void> = [];
	const lists = [...(root.matches('ul, ol, li') ? [root] : []), ...root.querySelectorAll<HTMLElement>('ul, ol, li')];
	for (const element of lists) {
		if (!owns(element) || element.closest('.markdown-embed')) continue;
		const children = [...element.children];
		const classes: string[] = [];
		if (element.matches('ul, ol')) {
			if (children.some(child => child.matches('li'))) classes.push('paraflow-reading-list');
		} else {
			const list = element.parentElement;
			if (list?.matches('ol') && !element.matches('.task-list-item, .footnotes li') &&
				(!list.getAttribute('type') || list.getAttribute('type') === '1') &&
				[ list, element ].every(item => !item.style.listStyleType || item.style.listStyleType === 'decimal')) {
				classes.push('paraflow-reading-list-decimal');
			}
			if (children.some(child => child.matches('ul, ol'))) classes.push('paraflow-reading-list-parent');
			if (children.some(child => child.matches('.list-bullet'))) classes.push('paraflow-reading-list-native-bullet');
			if (element.lastElementChild?.matches('p')) {
				classes.push('paraflow-reading-list-loose-end');
				if (element.nextElementSibling?.matches('li')) classes.push('paraflow-reading-list-loose-before-item');
			}
		}
		const added = classes.filter(name => !element.classList.contains(name));
		if (!added.length) continue;
		const hadClass = element.hasAttribute('class');
		element.classList.add(...added);
		if (added.includes('paraflow-reading-list-decimal') && element.hasAttribute('value')) {
			const hadStyle = element.hasAttribute('style');
			const previous = element.style.getPropertyValue('counter-set'), priority = element.style.getPropertyPriority('counter-set');
			element.style.setProperty('counter-set', `list-item ${(element as HTMLLIElement).value}`);
			restore.push(() => {
				if (previous) element.style.setProperty('counter-set', previous, priority); else element.style.removeProperty('counter-set');
				if (!hadStyle && !element.getAttribute('style')) element.removeAttribute('style');
			});
		}
		restore.push(() => {
			element.classList.remove(...added);
			if (!hadClass && !element.className) element.removeAttribute('class');
		});
	}
	return () => { for (const undo of restore) undo(); };
}
