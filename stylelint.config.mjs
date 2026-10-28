import obsidian from 'stylelint-config-obsidianmd';

// Community-specific checks are separate from stylelint-standard formatting rules.
export default {
	plugins: obsidian.plugins,
	rules: {
		...obsidian.rules,
		'plugin/no-unsupported-browser-features': [true, {
			severity: 'warning', browsers: ['electron >= 43'],
			ignore: ['css-nesting', 'css-cascade-layers'],
		}],
		'selector-type-no-unknown': [true, {
			severity: 'warning', ignoreTypes: ['mjx-container', 'mjx-tool', 'mjx-tip', 'mjx-status'],
		}],
	},
};
