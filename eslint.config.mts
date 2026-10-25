import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'.local/**',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json',
					],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,

	{
		files: ['src/settings-tab.ts', 'src/themes/import-modal.ts'],
		rules: { 'obsidianmd/ui/sentence-case': ['warn', { enforceCamelCaseLower: true, brands: ['Typora', 'ParaFlow', 'Obsidian', 'Markdown'], ignoreWords: ['ZIP'] }] },
	},
	{
		// Theme and module style owners manage one stylesheet per window and remove it on close or unload.
		files: ['src/themes/manager.ts', 'src/display/styles.ts'],
		rules: { 'obsidianmd/no-forbidden-elements': 'off' },
	},

	{
		files: ['src/editor/structured-list/**/*.ts'],
		rules: {
			complexity: ['error', 8],
			'max-depth': ['error', 3],
			'max-lines-per-function': [
				'error',
				{ max: 60, skipBlankLines: true, skipComments: true },
			],
		},
	},


);
