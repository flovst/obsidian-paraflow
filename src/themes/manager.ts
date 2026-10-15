export class ThemeManager {
	private readonly styles = new Map<Document, HTMLStyleElement>();
	private theme: { id: string; css: string } | null = null;

	setTheme(theme: { id: string; css: string } | null): void {
		this.theme = theme;
		for (const [document, style] of this.styles) this.update(document, style);
	}

	syncDocuments(documents: Iterable<Document>): void {
		const next = new Set(documents);
		for (const [document, style] of this.styles) {
			if (!next.has(document)) {
				style.remove(); document.body.removeAttribute('data-paraflow-theme');
				this.styles.delete(document);
			}
		}
		for (const document of next) {
			if (this.styles.has(document)) continue;
			// Selectable local themes require a stylesheet per window, independently of plugin core CSS.
			const style = document.createElement('style');
			style.setAttribute('data-paraflow-content-theme', '');
			document.head.appendChild(style); this.styles.set(document, style);
			this.update(document, style);
		}
	}

	private update(document: Document, style: HTMLStyleElement): void {
		style.textContent = this.theme?.css ?? '';
		if (this.theme) document.body.setAttribute('data-paraflow-theme', this.theme.id);
		else document.body.removeAttribute('data-paraflow-theme');
	}

	destroy(): void { this.syncDocuments([]); this.theme = null; }
}
