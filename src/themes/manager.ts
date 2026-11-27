import { themeAccentCss } from './accent-css.js';

type ContentTheme = { id: string; css: string } | null;

export class ThemeManager {
	private styles = new Map<Document, CSSStyleSheet>();
	private theme: ContentTheme = null;
	private accentStyles = new Set<{ document: Document; sheet: CSSStyleSheet }>();
	private accentCss = '';

	mountAccentPreview(parent: HTMLElement): () => void {
		const document = parent.ownerDocument;
		const style = { document, sheet: this.createSheet(document, { id: '', css: this.accentCss }) };
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, style.sheet];
		this.accentStyles.add(style);
		return () => {
			document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== style.sheet);
			this.accentStyles.delete(style);
		};
	}

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
		const accentCss = theme === this.theme ? this.accentCss : themeAccentCss(theme?.css ?? '');
		const accentUpdates = theme === this.theme ? [] : [...this.accentStyles].map(style => ({
			style, sheet: this.createSheet(style.document, { id: '', css: accentCss }),
		}));
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
			for (const { style, sheet } of accentUpdates) {
				const document = style.document;
				if (!previous.has(document)) previous.set(document, [...document.adoptedStyleSheets]);
				document.adoptedStyleSheets = document.adoptedStyleSheets.map(current => current === style.sheet ? sheet : current);
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
		this.accentCss = accentCss;
		for (const { style, sheet } of accentUpdates) style.sheet = sheet;
	}

	destroy(): void {
		this.apply(new Map(), null);
		for (const { document, sheet } of this.accentStyles) document.adoptedStyleSheets = document.adoptedStyleSheets.filter(current => current !== sheet);
		this.accentStyles.clear();
	}
}
