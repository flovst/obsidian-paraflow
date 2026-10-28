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
		restore.push(() => {
			element.classList.remove(...added);
			if (!hadClass && !element.className) element.removeAttribute('class');
		});
	}
	return () => { for (const undo of restore) undo(); };
}
