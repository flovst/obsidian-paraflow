import type { ThemeManifest } from './model.js';

declare const __PARAFLOW_CLASSIC_CSS__: string;
export const classicManifest: ThemeManifest = {
	schemaVersion: 1, id: 'builtin-classic', name: 'ParaFlow Classic', origin: 'builtin', colorScheme: 'adaptive',
};
export function classicCss(): string { return __PARAFLOW_CLASSIC_CSS__; }
