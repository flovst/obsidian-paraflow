const NAMED_REFERENCE = 'sup.footnote-ref > a.footnote-link[data-footref][href^="#fn-"]:not(.footnote-backref)';

/** Keep native destinations and inline notes; show the original named-reference ID. */
export function normalizeReadingFootnoteLabels(root: HTMLElement, source: string | null = null): () => void {
	const restore: Array<() => void> = [];
	const ids = new Map<string, string>();
	const anchors = [...(root.matches(NAMED_REFERENCE) ? [root] : []), ...root.querySelectorAll<HTMLElement>(NAMED_REFERENCE)];
	for (const anchor of anchors) {
		if (anchor.closest('.markdown-source-view, pre, code')) continue;
		const reference = anchor.parentElement!;
		const hadReferenceClass = reference.classList.contains('paraflow-reading-footnote-reference');
		reference.classList.add('paraflow-reading-footnote-reference');
		restore.push(() => { if (!hadReferenceClass) reference.classList.remove('paraflow-reading-footnote-reference'); });
		ids.set(anchor.getAttribute('href')!.slice(1), anchor.dataset.footref!);
		const node = anchor.firstChild;
		if (anchor.childNodes.length !== 1 || node?.nodeType !== 3) continue;
		const text = node as Text;
		const original = text.data;
		const match = /^\[(\d+)(?:-\d+)*\]$/u.exec(original);
		if (!match) continue;
		const label = anchor.dataset.footref!;
		if (original === label) continue;
		text.data = label;
		restore.push(() => {
			if (text.parentNode === anchor && text.data === label) text.data = original;
		});
	}
	const definitions = [...root.querySelectorAll<HTMLElement>('.footnotes > ol > li[id^="fn-"]')];
	const sourceDefinitions = source === null || !definitions.length ? [] : buildFootnoteIndex(source).definitions;
	for (const definition of definitions) {
		const number = /^fn-(\d+)-/u.exec(definition.id)?.[1];
		const id = definition.dataset.paraflowFootnoteId ?? ids.get(definition.id) ?? sourceDefinitions.find(note => note.status === 'resolved' && String(note.number) === number)?.id;
		if (!id) continue;
		const label = root.ownerDocument.createElement('span');
		label.className = 'paraflow-reading-footnote-label';
		label.textContent = id;
		const hadClass = definition.classList.contains('paraflow-reading-footnote');
		const hadClassAttribute = definition.hasAttribute('class');
		definition.classList.add('paraflow-reading-footnote');
		(definition.querySelector(':scope > p') ?? definition).prepend(label);
		restore.push(() => {
			label.remove();
			if (!hadClass) definition.classList.remove('paraflow-reading-footnote');
			if (!hadClassAttribute && definition.className === '') definition.removeAttribute('class');
		});
	}
	return () => { for (const undo of restore) undo(); };
}
import { buildFootnoteIndex } from './index.js';
