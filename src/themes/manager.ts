type ContentTheme = { id: string; css: string } | null;

export class ThemeManager {
	private styles = new Map<Document, CSSStyleSheet>();
	private theme: ContentTheme = null;

	setTheme(theme: ContentTheme): void {
		const next = new Map<Document, CSSStyleSheet>();
		for (const document of this.styles.keys()) next.set(document, this.createSheet(document, theme));
		this.apply(next, theme);
	}

	syncDocuments(documents: Iterable<Document>): void {
		const next = new Map<Document, CSSStyleSheet>();
		for (const document of new Set(documents)) {
			next.set(document, this.styles.get(document) ?? this.createSheet(document, this.theme));
		}
		this.apply(next, this.theme);
	}

	private createSheet(document: Document, theme: ContentTheme): CSSStyleSheet {
		const Sheet = document.defaultView?.CSSStyleSheet;
		if (!Sheet || typeof Sheet.prototype.replaceSync !== 'function' || !('adoptedStyleSheets' in document)) {
			throw new Error('ParaFlow themes require constructed stylesheets in each editor window.');
		}
		const sheet = new Sheet();
		sheet.replaceSync(theme?.css ?? '');
		return sheet;
	}

	private apply(next: Map<Document, CSSStyleSheet>, theme: ContentTheme): void {
		const previous = new Map<Document, CSSStyleSheet[]>();
		try {
			for (const document of new Set([...this.styles.keys(), ...next.keys()])) {
				const oldSheet = this.styles.get(document), newSheet = next.get(document);
				if (oldSheet === newSheet) continue;
				const sheets = [...document.adoptedStyleSheets];
				previous.set(document, sheets);
				const replacement = sheets.flatMap(sheet => sheet === oldSheet ? (newSheet ? [newSheet] : []) : [sheet]);
				if (newSheet && (!oldSheet || !sheets.includes(oldSheet))) replacement.push(newSheet);
				document.adoptedStyleSheets = replacement;
			}
		} catch (error) {
			const errors = [error];
			for (const [document, sheets] of previous) {
				try { document.adoptedStyleSheets = sheets; } catch (rollbackError) { errors.push(rollbackError); }
			}
			if (errors.length > 1) throw new AggregateError(errors, 'Theme update failed and stylesheet rollback is incomplete.');
			throw error;
		}
		for (const document of new Set([...this.styles.keys(), ...next.keys()])) {
			if (next.has(document) && theme) document.body.setAttribute('data-paraflow-theme', theme.id);
			else document.body.removeAttribute('data-paraflow-theme');
		}
		this.styles = next;
		this.theme = theme;
	}

	destroy(): void { this.apply(new Map(), null); }
}
