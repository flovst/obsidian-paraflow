import { unzipSync, zipSync } from 'fflate';
import { validateRelativePath } from './store.js';

export const MAX_THEME_FILES = 2000;
export const MAX_THEME_BYTES = 64 * 1024 * 1024;
export interface ImportFile { name: string; arrayBuffer(): Promise<ArrayBuffer>; size: number; webkitRelativePath?: string }

export function validatePackage(files: ReadonlyMap<string, Uint8Array>): void {
	if (files.size > MAX_THEME_FILES) throw new Error('Theme package exceeds 2,000 files');
	let size = 0; const names = new Set<string>();
	for (const [path, bytes] of files) {
		validateRelativePath(path);
		if (names.has(path.toLowerCase())) throw new Error(`Conflicting theme path: ${path}`);
		names.add(path.toLowerCase()); size += bytes.byteLength;
	}
	if (size > MAX_THEME_BYTES) throw new Error('Theme package exceeds 64 MiB');
}

export function unpackTheme(bytes: Uint8Array): Map<string, Uint8Array> {
	if (bytes.byteLength > MAX_THEME_BYTES) throw new Error('Theme package exceeds 64 MiB');
	let count = 0; let total = 0; const seen = new Set<string>();
	const extracted = unzipSync(bytes, { filter(file) {
		if (++count > MAX_THEME_FILES) throw new Error('Theme package exceeds 2,000 entries');
		validateRelativePath(file.name.replace(/\/$/u, ''));
		if (seen.has(file.name.toLowerCase())) throw new Error(`Conflicting theme path: ${file.name}`);
		seen.add(file.name.toLowerCase()); total += file.originalSize;
		if (total > MAX_THEME_BYTES) throw new Error('Theme package exceeds 64 MiB');
		return !file.name.endsWith('/');
	} });
	const files = new Map(Object.entries(extracted)); validatePackage(files); return files;
}

export async function readImportFiles(selected: readonly ImportFile[]): Promise<Map<string, Uint8Array>> {
	if (selected.length === 1 && /\.zip$/iu.test(selected[0]!.name)) {
		if (selected[0]!.size > MAX_THEME_BYTES) throw new Error('Theme package exceeds 64 MiB');
		return unpackTheme(new Uint8Array(await selected[0]!.arrayBuffer()));
	}
	if (selected.length > MAX_THEME_FILES || selected.reduce((sum, file) => sum + file.size, 0) > MAX_THEME_BYTES) {
		throw new Error('Theme package exceeds 2,000 files or 64 MiB');
	}
	const files = new Map<string, Uint8Array>();
	for (const file of selected) {
		const path = file.webkitRelativePath || file.name;
		if (files.has(path)) throw new Error(`Conflicting theme path: ${path}`);
		files.set(path, new Uint8Array(await file.arrayBuffer()));
	}
	validatePackage(files); return files;
}

export function themeEntries(files: ReadonlyMap<string, Uint8Array>): string[] {
	return [...files.keys()].filter((path) => /\.css$/iu.test(path) && !/\.user\.css$/iu.test(path)).sort();
}

export function createThemeArchive(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
	validatePackage(files); return zipSync(Object.fromEntries(files));
}

export function prepareThemeImport(files: Map<string, Uint8Array>): {
	files: Map<string, Uint8Array>; overrides: string; assets: Map<string, Uint8Array>; entry: string; name: string;
} {
	const result = { files, overrides: '', assets: new Map<string, Uint8Array>(), entry: '', name: '' };
	if (files.has('theme.json') && [...files.keys()].some(path => path.startsWith('source/'))) {
		const metadata = JSON.parse(new TextDecoder().decode(files.get('theme.json'))) as Record<string, unknown>;
		if (metadata.schemaVersion === 1 && ['builtin', 'imported'].includes(String(metadata.origin))) {
			result.entry = typeof metadata.sourceEntry === 'string' ? metadata.sourceEntry : '';
			result.name = typeof metadata.name === 'string' ? metadata.name : '';
			if (files.has('overrides.css')) result.overrides = new TextDecoder().decode(files.get('overrides.css'));
			result.assets = new Map([...files].filter(([path]) => path.startsWith('assets/')).map(([path, bytes]) => [path.slice(7), bytes]));
			result.files = new Map([...files].filter(([path]) => path.startsWith('source/')).map(([path, bytes]) => [path.slice(7), bytes]));
		}
	}
	if (!result.files.has(result.entry)) result.entry = themeEntries(result.files)[0] ?? '';
	if (!result.name) result.name = result.entry.split('/').at(-1)?.replace(/\.css$/iu, '') ?? '';
	return result;
}
