import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Bundle runtime files once per entry, including package-shared assets. */
export function loadThemeBundles(root = '.') {
	const catalogue = JSON.parse(readFileSync(join(root, 'themes/bundled.json'), 'utf8'));
	return catalogue.map(entry => {
		if (!/^[a-z0-9-]+$/.test(entry.directory)) throw new Error('Invalid bundled theme directory');
		const directory = join(root, 'themes', entry.directory);
		const files = [];
		function visit(relative = '') {
			for (const item of readdirSync(join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
				if (relative === '' && item.name === 'source') continue;
				const path = relative + item.name;
				if (item.isDirectory()) visit(path + '/');
				else if (item.isFile()) files.push([path, readFileSync(join(directory, path)).toString('base64')]);
				else throw new Error(`Unsupported theme resource: ${path}`);
			}
		}
		visit();
		const manifest = JSON.parse(readFileSync(join(directory, 'theme.json'), 'utf8'));
		const themes = manifest.type === 'package'
			? manifest.themes.map(child => JSON.parse(readFileSync(join(directory, child, 'theme.json'), 'utf8'))) : [manifest];
		if (JSON.stringify(themes.map(theme => theme.id)) !== JSON.stringify(entry.themeIds)) throw new Error(`Bundled theme IDs differ: ${entry.directory}`);
		return { manifest, themes, files };
	});
}
