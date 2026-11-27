/** All accent modes share the host swatch geometry. */
export function renderAccentPreview(parent: HTMLElement, source: 'host' | 'theme' | 'custom', label: string): HTMLElement {
	const preview = parent.createSpan({ cls: 'paraflow-accent-preview' });
	preview.dataset.source = source;
	if (source === 'theme') preview.classList.add('paraflow-accent-theme');
	if (source !== 'custom') {
		preview.setAttribute('role', 'img');
		preview.setAttribute('aria-label', label);
	}
	return preview;
}
