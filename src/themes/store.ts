import type { ConvertedTheme, ThemeManifest } from './model.js';

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

export function validateThemeId(id: string): void {
	if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(id)) throw new Error('Invalid theme id');
}

export function validateRelativePath(path: string): string {
	if (!path || path.includes('\\') || path.includes(':') || path.startsWith('/')
		|| path.split('/').some((part) => !part || part === '.' || part === '..' || /[<>"|?*]|[. ]$/u.test(part)
			|| /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))
		|| [...path].some(character => character.charCodeAt(0) < 32)) throw new Error(`Unsafe theme path: ${path}`);
	return path;
}

export function parseManifest(text: string, id: string): ThemeManifest {
	const value = JSON.parse(text) as Partial<ThemeManifest> | null;
	if (!value || value.schemaVersion !== 1 || value.id !== id || typeof value.name !== 'string'
		|| !value.name.trim() || !['builtin', 'imported'].includes(value.origin ?? '')
		|| !['light', 'dark', 'adaptive'].includes(value.colorScheme ?? '')) {
		throw new Error(`Invalid theme manifest: ${id}`);
	}
	return value as ThemeManifest;
}

export class ThemeStore {
	constructor(readonly storage: ThemeStorage, readonly root: string) {}

	private async mkdir(path: string): Promise<void> {
		if (await this.storage.exists(path)) return;
		const parent = path.slice(0, path.lastIndexOf('/'));
		if (parent) await this.mkdir(parent);
		await this.storage.mkdir(path);
	}

	path(id: string): string { validateThemeId(id); return `${this.root}/${id}`; }

	async list(): Promise<{ themes: ThemeManifest[]; warnings: string[] }> {
		await this.mkdir(this.root);
		const themes: ThemeManifest[] = []; const warnings: string[] = [];
		for (const dir of (await this.storage.list(this.root)).folders) {
			const id = dir.slice(dir.lastIndexOf('/') + 1);
			try { themes.push((await this.read(id)).manifest); }
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
		const dir = this.path(manifest.id); await this.mkdir(dir);
		await this.storage.write(`${dir}/theme.css`, css);
		await this.storage.write(`${dir}/theme.json`, JSON.stringify(manifest, null, 2));
		if (!await this.storage.exists(`${dir}/overrides.css`)) {
			await this.storage.write(`${dir}/overrides.css`, '/* Local content theme overrides. */\n');
		}
	}

	async install(theme: ConvertedTheme, overrides = '/* Local content theme overrides. */\n'): Promise<void> {
		const dir = this.path(theme.manifest.id);
		if (await this.storage.exists(dir)) throw new Error(`Theme already exists: ${theme.manifest.name}`);
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

	async exportFiles(id: string): Promise<Map<string, Uint8Array>> {
		const base = this.path(id); const files = new Map<string, Uint8Array>();
		await this.read(id);
		const visit = async (dir: string): Promise<void> => {
			const listing = await this.storage.list(dir);
			for (const path of listing.files) {
				const relative = validateRelativePath(path.slice(base.length + 1));
				files.set(relative, new Uint8Array(await this.storage.readBinary(path)));
			}
			for (const child of listing.folders) await visit(child);
		};
		await visit(base); return files;
	}
}
