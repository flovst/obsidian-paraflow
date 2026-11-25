export interface ThemeManifest {
	schemaVersion: 1;
	id: string;
	name: string;
	origin: 'builtin' | 'imported';
	colorScheme: 'light' | 'dark' | 'adaptive';
	/** A light base palette and dark palette selected by body.theme-dark / body.theme-light. */
	colorSchemeVariants?: 'host-class';
	converterVersion?: string;
	sourceVersion?: string;
	sourceEntry?: string;
	sourceApp?: string;
	sourcePackage?: string;
	/** Null explicitly keeps a theme independent; absence allows known bundled metadata. */
	packageId?: string | null;
}

export type ThemeSourceMetadata = Pick<ThemeManifest, 'sourceApp' | 'sourcePackage' | 'packageId'>;

export interface ThemePackageManifest {
	schemaVersion: 1;
	type: 'package';
	id: string;
	name: string;
	themes: string[];
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
