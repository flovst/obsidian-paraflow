import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import stylelint from 'stylelint';

const source = process.argv.includes('--sources');
const themes = JSON.parse(readFileSync('themes/bundled.json', 'utf8'));
const files = source
	? themes.map(theme => `themes/${theme}/source/**/*.css`)
	: ['styles.css', 'themes/builtin-classic/theme.css', ...themes.flatMap(theme => [
		`themes/${theme}/theme.css`, `themes/${theme}/overrides.css`,
	])];
const result = await stylelint.lint({ files, configFile: resolve('stylelint.config.mjs') });
const counts = new Map();
let errors = 0;
const print = text => process.stdout.write(text + '\n');
for (const file of result.results) {
	for (const warning of file.warnings) {
		const key = `${warning.severity}: ${warning.rule}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
		if (warning.severity === 'error') errors++;
	}
	for (const error of file.parseErrors ?? []) {
		errors++; process.stderr.write(`${file.source}:${error.line}:${error.column} ${error.text}\n`);
	}
}
if (process.argv.includes('--json')) print(JSON.stringify(result.results.map(({ source, warnings, parseErrors }) => ({ source, warnings, parseErrors })), null, 2));
else {
	print(`${source ? 'Archived Typora source' : 'Runtime stylesheets'}: ${result.results.length} files`);
	for (const [rule, count] of [...counts].sort()) print(`${rule}: ${count}`);
	print(`Errors: ${errors}`);
}
if (result.errored || errors) process.exitCode = 1;
