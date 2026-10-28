# Content themes

[Documentation](../../README.md) · [中文](../zh-CN/themes.zh.md)

ParaFlow currently includes five of Typora's default themes, which you can select in the settings.

The settings also offer an experimental Typora theme importer, which is still unstable. The source repository includes a Skill for importing Typora themes. If you have a particular theme in mind, I recommend letting your agent try that approach.

## Importing a Typora theme (experimental)

1. Click “Import theme” and choose a CSS file, ZIP archive, or theme folder.
2. Click “Preview conversion” to review mapped, approximate, and skipped rules.
3. Click “Save theme,” then select it in the theme menu to apply it.

Import directories use the theme name, such as `typora-github`. Import mainly processes local CSS and assets; remote resources are not downloaded.

The conversion report helps locate individual rule and resource issues. No convertible body rules, missing required CSS imports, and invalid paths can block saving. Missing optional fonts or images are reported.

### Adjusting theme files

Use “Open theme folder” to locate the current theme. Its usual location is `paraflow/themes/<theme-id>/` under the vault's plugin directory:

| File or directory | Contents |
| --- | --- |
| `theme.json` | Theme information |
| `theme.css` | Generated styles |
| `overrides.css` | User style additions |
| `conversion-report.json` | Conversion report |
| `assets/` | Local fonts and images |
| `source/` | Imported source files |

Edit `overrides.css`, then click “Reload.” Use content element selectors, Obsidian content classes, and `:root` variables. For example:

```css
h1 { color: #225588; }
.cm-header-1 { color: #225588; }
```

Use `url(assets/filename)` for local resources. Overrides support ordinary rules, `@media`, and `@supports`; font registration is handled by importing the source theme.

Check the result in both Reading view and Live Preview. Theme management scopes these additional styles to the content area.

### Exporting

“Export” packages an imported theme's source files, assets, overrides, and report as a ZIP. Importing it again runs conversion again. Local font, width, and similar adjustments from the theme settings are stored separately in plugin settings and are excluded from the theme export.

## Examples

Open the [showcase index](../../../dist/showcase/README.md), switch between Follow Obsidian and ParaFlow Classic, then compare an imported theme across body text, lists, tables, math, and code.
