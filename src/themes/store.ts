import type { ConvertedTheme, ThemeManifest, ThemePackageManifest, ThemeSourceMetadata } from './model.js';
import { resolveThemeUrls } from './runtime-css.js';
import { readThemePackage } from './packaged-theme.js';

export interface ThemeStorage {
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	read(path: string): Promise<string>;
	readBinary(path: string): Promise<ArrayBuffer>;
	rmdir(path: string, recursive: boolean): Promise<void>;
	write(path: string, text: string): Promise<void>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	getResourcePath(path: string): string;
}

const themeIdPattern = /^[a-z0-9][a-z0-9-]{0,79}$/u;

export function validateThemeId(id: string): void {
	if (typeof id !== 'string' || !themeIdPattern.test(id)) throw new Error('Invalid theme id');
}

export function validateRelativePath(path: string): string {
	if (!path || path.includes('\\') || path.includes(':') || path.startsWith('/')
		|| path.split('/').some((part) => !part || part === '.' || part === '..' || /[<>"|?*]|[. ]$/u.test(part)
			|| /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))
		|| [...path].some(character => character.charCodeAt(0) < 32)) throw new Error(`Unsafe theme path: ${path}`);
	return path;
}

export function validateSourceMetadata(value: ThemeSourceMetadata): void {
	if (value.packageId !== undefined && value.packageId !== null && (typeof value.packageId !== 'string' || !themeIdPattern.test(value.packageId))) {
		throw new Error('Invalid theme manifest: packageId');
	}
	for (const key of ['sourceApp', 'sourcePackage'] as const) {
		const label = value[key];
		if (label !== undefined && (typeof label !== 'string' || !label.trim() || label.length > 200
			|| [...label].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) {
			throw new Error(`Invalid theme manifest: ${key}`);
		}
	}
}

export function parseManifest(text: string, id: string): ThemeManifest {
	const value = JSON.parse(text) as Partial<ThemeManifest> | null;
	if (!value || value.schemaVersion !== 1 || value.id !== id || typeof value.name !== 'string'
		|| !value.name.trim() || !['builtin', 'imported'].includes(value.origin ?? '')
		|| !['light', 'dark', 'adaptive'].includes(value.colorScheme ?? '')) {
		throw new Error(`Invalid theme manifest: ${id}`);
	}
	validateSourceMetadata(value);
	if (value.colorSchemeVariants !== undefined && (value.colorSchemeVariants !== 'host-class' || value.colorScheme !== 'adaptive')) {
		throw new Error('Invalid theme manifest: colorSchemeVariants');
	}
	return value as ThemeManifest;
}

export function parseThemePackage(text: string, id: string): ThemePackageManifest {
	const value = JSON.parse(text) as Partial<ThemePackageManifest> | null;
	validateThemeId(id);
	if (!value || value.schemaVersion !== 1 || value.type !== 'package' || value.id !== id
		|| typeof value.name !== 'string' || !value.name.trim() || !Array.isArray(value.themes) || !value.themes.length) {
		throw new Error(`Invalid theme package: ${id}`);
	}
	for (const directory of value.themes) {
		if (typeof directory !== 'string') throw new Error('Invalid theme directory');
		validateThemeId(directory);
		if (['assets', 'source'].includes(directory)) throw new Error(`Reserved theme directory: ${directory}`);
	}
	if (new Set(value.themes.map(name => name.toLowerCase())).size !== value.themes.length) throw new Error('Duplicate theme directory');
	return value as ThemePackageManifest;
}

export class ThemeStore {
	private locations = new Map<string, { directory: string; packageRoot?: string }>();
	constructor(readonly storage: ThemeStorage, readonly root: string) {}

	private async mkdir(path: string): Promise<void> {
		if (await this.storage.exists(path)) return;
		const parent = path.slice(0, path.lastIndexOf('/'));
		if (parent) await this.mkdir(parent);
		await this.storage.mkdir(path);
	}

	path(id: string): string { validateThemeId(id); return this.locations.get(id)?.directory ?? `${this.root}/${id}`; }

	assetRoot(id: string): string { return this.locations.get(id)?.packageRoot ?? this.path(id); }

	async list(): Promise<{ themes: ThemeManifest[]; warnings: string[] }> {
		await this.mkdir(this.root);
		this.locations.clear();
		const themes: ThemeManifest[] = []; const warnings: string[] = [];
		for (const dir of (await this.storage.list(this.root)).folders) {
			const id = dir.slice(dir.lastIndexOf('/') + 1);
			try {
				const text = await this.storage.read(`${dir}/theme.json`);
				const metadata = JSON.parse(text) as { type?: unknown };
				const entries = metadata.type === 'package'
					? await Promise.all(parseThemePackage(text, id).themes.map(async child => {
						const directory = `${dir}/${child}`;
						const childText = await this.storage.read(`${directory}/theme.json`);
						const childId = (JSON.parse(childText) as { id: string }).id;
						validateThemeId(childId);
						return { manifest: parseManifest(childText, childId), directory, packageRoot: dir };
					}))
					: [{ manifest: parseManifest(text, id), directory: dir, packageRoot: undefined }];
				const ids = entries.map(entry => entry.manifest.id);
				if (new Set(ids).size !== ids.length || ids.some(key => this.locations.has(key))) throw new Error('Duplicate theme id');
				for (const entry of entries) this.locations.set(entry.manifest.id, entry);
				try {
					const loaded = await Promise.all(ids.map(key => this.read(key)));
					themes.push(...loaded.map(theme => theme.manifest));
				} catch (error) {
					for (const key of ids) this.locations.delete(key);
					throw error;
				}
			}
			catch (error) { warnings.push(`${id}: ${String(error)}`); }
		}
		return { themes: themes.sort((a, b) => a.name.localeCompare(b.name)), warnings };
	}

	async read(id: string): Promise<{ manifest: ThemeManifest; css: string; overrides: string }> {
		const dir = this.path(id);
		const manifest = parseManifest(await this.storage.read(`${dir}/theme.json`), id);
		const css = await this.storage.read(`${dir}/theme.css`);
		const overrides = await this.storage.exists(`${dir}/overrides.css`)
			? await this.storage.read(`${dir}/overrides.css`) : '';
		return { manifest, css, overrides };
	}

	async ensureBuiltin(manifest: ThemeManifest, css: string): Promise<void> {
		validateSourceMetadata(manifest);
		const dir = this.path(manifest.id);
		const refreshed = { ...manifest };
		if (await this.storage.exists(`${dir}/theme.json`)) {
			const existing = parseManifest(await this.storage.read(`${dir}/theme.json`), manifest.id);
			for (const key of ['sourceApp', 'sourcePackage', 'packageId'] as const) {
				if (Object.hasOwn(existing, key)) Object.assign(refreshed, { [key]: existing[key] });
			}
		}
		await this.mkdir(dir);
		await this.storage.write(`${dir}/theme.css`, css);
		await this.storage.write(`${dir}/theme.json`, JSON.stringify(refreshed, null, 2));
		if (!await this.storage.exists(`${dir}/overrides.css`)) {
			await this.storage.write(`${dir}/overrides.css`, '/* Local content theme overrides. */\n');
		}
	}

	async updateMetadata(id: string, patch: ThemeSourceMetadata): Promise<void> {
		const { manifest } = await this.read(id);
		if (Object.hasOwn(patch, 'packageId')) manifest.packageId = patch.packageId === '' || patch.packageId === undefined ? null : patch.packageId;
		for (const key of ['sourceApp', 'sourcePackage'] as const) {
			if (!Object.hasOwn(patch, key)) continue;
			const label = patch[key];
			if (label === undefined || label === '') delete manifest[key];
			else manifest[key] = label;
		}
		const text = JSON.stringify(manifest, null, 2);
		parseManifest(text, id);
		await this.storage.write(`${this.path(id)}/theme.json`, text);
	}

	async install(theme: ConvertedTheme, overrides = '/* Local content theme overrides. */\n'): Promise<void> {
		validateSourceMetadata(theme.manifest);
		const dir = this.path(theme.manifest.id);
		if (this.locations.has(theme.manifest.id) || await this.storage.exists(dir)) throw new Error(`Theme already exists: ${theme.manifest.name}`);
		// Validate all destinations before the first write. Manifest is the completion marker.
		for (const name of [...theme.assets.keys(), ...theme.sources.keys()]) validateRelativePath(name);
		await this.mkdir(dir);
		try {
			for (const [subdir, files] of [['assets', theme.assets], ['source', theme.sources]] as const) {
				for (const [name, bytes] of files) {
					const target = `${dir}/${subdir}/${name}`;
					await this.mkdir(target.slice(0, target.lastIndexOf('/')));
					await this.storage.writeBinary(target, new Uint8Array(bytes).buffer);
				}
			}
			await this.storage.write(`${dir}/theme.css`, theme.css);
			await this.storage.write(`${dir}/overrides.css`, overrides);
			await this.storage.write(`${dir}/conversion-report.json`, JSON.stringify(theme.diagnostics, null, 2));
			await this.storage.write(`${dir}/theme.json`, JSON.stringify(theme.manifest, null, 2));
		} catch (error) {
			await this.storage.rmdir(dir, true);
			throw error;
		}
	}

	async installPackage(files: ReadonlyMap<string, Uint8Array>): Promise<void> {
		for (const path of files.keys()) validateRelativePath(path);
		const { manifest, themes } = readThemePackage(files);
		await this.list();
		const dir = `${this.root}/${manifest.id}`;
		if (await this.storage.exists(dir) || themes.some(theme => this.locations.has(theme.manifest.id))) throw new Error('Theme package or theme already exists');
		await this.mkdir(dir);
		try {
			for (const [path, bytes] of files) {
				if (path === 'theme.json') continue;
				const target = `${dir}/${path}`;
				await this.mkdir(target.slice(0, target.lastIndexOf('/')));
				await this.storage.writeBinary(target, new Uint8Array(bytes).buffer);
			}
			await this.storage.write(`${dir}/theme.json`, JSON.stringify(manifest, null, 2));
		} catch (error) {
			await this.storage.rmdir(dir, true);
			throw error;
		}
		for (const [index, theme] of themes.entries()) {
			this.locations.set(theme.manifest.id, { directory: `${dir}/${manifest.themes[index]!}`, packageRoot: dir });
		}
	}

	async exportFiles(id: string, wholePackage = false): Promise<Map<string, Uint8Array>> {
		const packageRoot = this.locations.get(id)?.packageRoot;
		const base = wholePackage && packageRoot ? packageRoot : this.path(id);
		const files = new Map<string, Uint8Array>();
		const theme = await this.read(id);
		const visit = async (dir: string, relativeBase = base): Promise<void> => {
			const listing = await this.storage.list(dir);
			for (const path of listing.files) {
				const relative = validateRelativePath(path.slice(relativeBase.length + 1));
				files.set(relative, new Uint8Array(await this.storage.readBinary(path)));
			}
			for (const child of listing.folders) await visit(child, relativeBase);
		};
		await visit(base);
		if (packageRoot && !wholePackage) {
			const encoder = new TextEncoder();
			files.set('theme.css', encoder.encode(resolveThemeUrls(theme.css, String, true)));
			files.set('overrides.css', encoder.encode(resolveThemeUrls(theme.overrides, String, true)));
			const assets = `${packageRoot}/assets`;
			if (await this.storage.exists(assets)) await visit(assets, packageRoot);
		}
		return files;
	}
}
