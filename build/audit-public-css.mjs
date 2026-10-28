import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, parse, walk } from 'css-tree';
import stylelint from 'stylelint';
import obsidian from 'stylelint-config-obsidianmd';
import currentConfig from '../stylelint.config.mjs';

const slash = path => path.replaceAll('\\', '/');

export function classifyCss(path) {
	if (path === 'styles.css') return 'generated-runtime';
	if (/^themes\/[^/]+\/source\//.test(path)) return 'archived-upstream';
	if (path.startsWith('src/')) return 'project-source';
	return 'runtime';
}

/** Use export rules privately and the tracked public tree after export. */
export function collectPublicCss(root, rules) {
	const files = new Map();
	function collect(sourcePath, publicPath = sourcePath) {
		const source = resolve(root, sourcePath);
		const local = relative(root, source);
		if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) throw new Error(`Source escapes project: ${sourcePath}`);
		let ancestor = root;
		for (const part of local.split(sep)) {
			ancestor = resolve(ancestor, part);
			if (lstatSync(ancestor).isSymbolicLink()) throw new Error(`Symlink/junction not allowed: ${ancestor}`);
		}
		const stat = lstatSync(source);
		if (stat.isDirectory()) {
			for (const name of readdirSync(source).sort()) collect(`${sourcePath}/${name}`, `${publicPath}/${name}`);
		} else if (stat.isFile() && publicPath.endsWith('.css')) {
			files.set(publicPath, { path: slash(publicPath), source, category: classifyCss(slash(publicPath)) });
		}
	}
	if (rules) {
		for (const path of rules.paths) collect(path);
		for (const entry of rules.mappings ?? []) collect(entry.source, entry.destination);
	} else {
		for (const path of execFileSync('git', ['ls-files', '-z', '--', '*.css'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)) collect(path);
	}
	return [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function auditProfiles() {
	return [
		{
			id: 'community-comparison', browsers: ['electron >= 39'],
			description: 'Local comparison using upstream community rules and an older Electron target; the saved official report does not expose its server configuration.',
			config: { plugins: obsidian.plugins, rules: {
				...obsidian.rules,
				'plugin/no-unsupported-browser-features': [true, { severity: 'warning', browsers: ['electron >= 39'], ignore: ['css-nesting', 'css-cascade-layers'] }],
			} },
		},
		{
			id: 'project-current', browsers: currentConfig.rules['plugin/no-unsupported-browser-features'][1].browsers,
			description: 'Current project rules, including its browser target and MathJax type allowlist.',
			config: currentConfig,
		},
	];
}

/** Context links identical authored/generated rules without counting them as one warning. */
export function warningContext(css, warnings) {
	const offsets = [0];
	for (let index = 0; index < css.length; index++) if (css[index] === '\n') offsets.push(index + 1);
	const contexts = warnings.map(warning => ({ offset: offsets[warning.line - 1] + warning.column - 1, selector: '', declaration: '' }));
	walk(parse(css, { positions: true }), node => {
		if (!node.loc || !['Rule', 'Declaration', 'Atrule'].includes(node.type)) return;
		for (const context of contexts) {
			if (context.offset < node.loc.start.offset || context.offset >= node.loc.end.offset) continue;
			if (node.type === 'Rule') context.selector = generate(node.prelude);
			else if (node.type === 'Declaration') context.declaration = generate(node);
			else context.selector = `@${node.name} ${node.prelude ? generate(node.prelude) : ''}`;
		}
	});
	return contexts.map(({ selector, declaration }) => ({ selector, declaration }));
}

function countsBy(items, key) {
	const counts = {};
	for (const item of items) counts[item[key]] = (counts[item[key]] ?? 0) + 1;
	return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

export function summarizeWarnings(warnings) {
	const groups = new Map();
	for (const warning of warnings) {
		if (!warning.selector && !warning.declaration) continue;
		const key = JSON.stringify([warning.rule, warning.text, warning.selector, warning.declaration]);
		const group = groups.get(key) ?? [];
		group.push(warning);
		groups.set(key, group);
	}
	const duplicates = [...groups.values()].filter(group => new Set(group.map(warning => warning.path)).size > 1).map(group => ({
		rule: group[0].rule, selector: group[0].selector, declaration: group[0].declaration,
		locations: group.map(({ path, line, column, category }) => ({ path, line, column, category })),
	}));
	return {
		total: warnings.length, byRule: countsBy(warnings, 'rule'), byCategory: countsBy(warnings, 'category'),
		duplicateGroups: duplicates,
	};
}

export async function auditCss(root, files, profiles = auditProfiles()) {
	const reports = [];
	for (const profile of profiles) {
		const warnings = [];
		const parseErrors = [];
		const result = await stylelint.lint({ files: files.map(file => file.source), config: profile.config, configBasedir: root });
		const paths = new Map(files.map(file => [resolve(file.source), file]));
		for (const entry of result.results) {
			const file = paths.get(resolve(entry.source));
			const css = readFileSync(file.source, 'utf8');
			for (const error of entry.parseErrors ?? []) parseErrors.push({ path: file.path, ...error });
			const contexts = entry.warnings.some(warning => warning.rule === 'CssSyntaxError') ? [] : warningContext(css, entry.warnings);
			entry.warnings.forEach((warning, index) => warnings.push({ path: file.path, category: file.category, ...warning, ...contexts[index] }));
		}
		reports.push({ id: profile.id, browsers: profile.browsers, description: profile.description,
			...summarizeWarnings(warnings), errors: warnings.filter(warning => warning.severity === 'error').length + parseErrors.length,
			warnings, parseErrors });
	}
	return { schemaVersion: 1, scope: 'Public CSS files (standalone CSS only; TypeScript is covered by ESLint)',
		files: files.map(({ path, category }) => ({ path, category })), profiles: reports };
}

export function observedComparison(groups, profile) {
	const cssGroups = groups.filter(group => group.locations.some(location => /\.css:\d+(?:-\d+)?$/.test(location)));
	const select = prefix => cssGroups.filter(group => group.title.startsWith(prefix)).reduce((sum, group) => sum + group.count, 0);
	return {
		description: 'Observed saved report totals, not a regenerated official report. Counts include archived and generated copies.',
		totalCss: cssGroups.reduce((sum, group) => sum + group.count, 0),
		checks: [
			{ rule: 'declaration-no-important', observed: select('Avoid !important'), local: profile.byRule['declaration-no-important'] ?? 0 },
			{ rule: 'selector-pseudo-class-disallowed-list', observed: select('Avoid :has'), local: profile.byRule['selector-pseudo-class-disallowed-list'] ?? 0 },
		],
		groups: cssGroups,
	};
}

async function main() {
	const options = {};
	const args = process.argv.slice(2);
	for (let index = 0; index < args.length; index++) {
		const flag = args[index];
		if (!['--root', '--output', '--observed'].includes(flag) || !args[index + 1] || args[index + 1].startsWith('--')) {
			throw new Error('Usage: node build/audit-public-css.mjs [--root repository] [--output report.json] [--observed saved-warnings.json]');
		}
		options[flag.slice(2)] = args[++index];
	}
	const root = resolve(options.root ?? '.');
	const rulesPath = resolve(root, 'scripts/public-files.json');
	const rules = existsSync(rulesPath) ? JSON.parse(readFileSync(rulesPath, 'utf8')) : undefined;
	const report = await auditCss(root, collectPublicCss(root, rules));
	if (options.observed) report.observed = observedComparison(JSON.parse(readFileSync(options.observed, 'utf8')), report.profiles[0]);
	if (options.output) writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
	else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	for (const profile of report.profiles) process.stderr.write(`${profile.id}: ${report.files.length} files, ${profile.total} warnings, ${profile.errors} errors; ${JSON.stringify(profile.byRule)}\n`);
	if (report.profiles.some(profile => profile.errors)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
