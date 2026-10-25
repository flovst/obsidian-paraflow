/** Common fence names; arbitrary valid language names remain editable. */
const languages = [
	'astro', 'bash', 'c', 'clojure', 'cmake', 'cpp', 'csharp', 'css', 'csv', 'dart', 'diff', 'dockerfile',
	'elixir', 'elm', 'erlang', 'go', 'graphql', 'groovy', 'haskell', 'html', 'ini', 'java', 'javascript',
	'json', 'jsx', 'julia', 'kotlin', 'lua', 'makefile', 'markdown', 'mermaid', 'objectivec', 'ocaml',
	'pascal', 'perl', 'php', 'plaintext', 'powershell', 'prolog', 'properties', 'protobuf', 'pug',
	'puppet', 'python', 'r', 'ruby', 'rust', 'sass', 'scala', 'scss', 'shell', 'sql', 'swift',
	'text', 'toml', 'tsx', 'typescript', 'vbnet', 'vue', 'xml', 'yaml', 'zig',
];

export function codeLanguageSuggestions(prefix: string): string[] {
	const query = prefix.trim().toLowerCase();
	return query ? languages.filter(language => language.startsWith(query) && language !== query) : [];
}

const iconPaths = {
	code: 'M5 5 2 8l3 3M11 5l3 3-3 3M9 3 7 13',
	script: 'M6 2h6v9a3 3 0 0 1-3 3H4a2 2 0 0 1-2-2v-1h6v1a2 2 0 0 0 4 0M6 2v7M8 5h2M8 8h2',
	terminal: 'M2 4h12v9H2zM4 6l2 2-2 2M8 10h3',
	markup: 'M5 4 1 8l4 4M11 4l4 4-4 4M9 2 7 14',
	data: 'M2 4c0-3 12-3 12 0s-12 3-12 0v8c0 3 12 3 12 0V4M2 8c0 3 12 3 12 0',
	diagram: 'M5 1h6v4H5zM1 11h5v4H1zM10 11h5v4h-5zM8 5v3M3.5 11V8h9v3',
	text: 'M3 3h10M3 6h7M3 9h10M3 12h7',
};
type LanguageIcon = keyof typeof iconPaths;
const iconGroups: Partial<Record<LanguageIcon, readonly string[]>> = {
	script: ['groovy', 'javascript', 'julia', 'lua', 'perl', 'php', 'python', 'r', 'ruby'],
	terminal: ['bash', 'cmake', 'dockerfile', 'makefile', 'powershell', 'shell'],
	markup: ['astro', 'css', 'html', 'jsx', 'markdown', 'pug', 'sass', 'scss', 'tsx', 'vue', 'xml'],
	data: ['csv', 'graphql', 'ini', 'json', 'properties', 'protobuf', 'puppet', 'sql', 'toml', 'yaml'],
	diagram: ['mermaid'],
	text: ['diff', 'plaintext', 'text'],
};

/** Category icons identify the kind of source without changing its fence name. */
export function codeLanguageIcon(language: string): { category: LanguageIcon; path: string } {
	const category = (Object.entries(iconGroups) as [LanguageIcon, readonly string[]][])
		.find(([, names]) => names.includes(language))?.[0] ?? 'code';
	return { category, path: iconPaths[category] };
}
