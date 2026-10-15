export interface ThemeManifest {
	schemaVersion: 1;
	id: string;
	name: string;
	origin: 'builtin' | 'imported';
	colorScheme: 'light' | 'dark' | 'adaptive';
	converterVersion?: string;
	sourceVersion?: string;
	sourceEntry?: string;
}

export interface ThemeInput {
	entry: string;
	files: ReadonlyMap<string, Uint8Array>;
}

export interface ThemeDiagnostic {
	file: string;
	line: number;
	surface: 'reading' | 'live-preview' | 'shared';
	status: 'mapped' | 'approximate' | 'skipped' | 'error';
	reason: string;
}

export interface ConvertedTheme {
	manifest: ThemeManifest;
	css: string;
	assets: ReadonlyMap<string, Uint8Array>;
	sources: ReadonlyMap<string, Uint8Array>;
	diagnostics: readonly ThemeDiagnostic[];
}
