import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'.local/**',
		'docs/dev/tasks/**',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'tsconfig.tools.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					defaultProject: 'tsconfig.tools.json',
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
		files: ['build/**/*.mjs', 'stylelint.config.mjs'],
		languageOptions: {
			globals: { ...globals.node },
			parserOptions: { projectService: false, project: './tsconfig.tools.json' },
		},
		rules: { 'obsidianmd/no-nodejs-modules': 'off' },
	},

	{
		files: ['src/settings-tab.ts', 'src/themes/import-modal.ts'],
		rules: { 'obsidianmd/ui/sentence-case': ['warn', { enforceCamelCaseLower: true, brands: ['Typora', 'ParaFlow', 'Obsidian', 'Markdown'], ignoreWords: ['ZIP'] }] },
	},
	{
		files: ['src/**/*.ts'],
		rules: {
			// Include ownerDocument and other receiver names missed by the upstream rule.
			'no-restricted-syntax': ['error', {
				selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="createDocumentFragment"]',
				message: 'Use createOwnedFragment to preserve document ownership through the Obsidian helper.',
			}, {
				selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name=/^(createElement|createEl)$/][arguments.0.value=/^(style|link)$/i]',
				message: 'Use the bundled styles.css or a document-owned CSSStyleSheet instead of style/link elements.',
			}, {
				selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="createElementNS"][arguments.1.value=/^(style|link)$/i]',
				message: 'Use the bundled styles.css or a document-owned CSSStyleSheet instead of style/link elements.',
			}],
		},
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
