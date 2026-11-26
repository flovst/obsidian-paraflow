# Content themes

A theme directory can contain one theme or a package with multiple themes. Package members share assets and remain individually selectable. Import a package ZIP or folder to install its members; exporting a selected theme produces a standalone ZIP.

[Documentation](../../README.md) · [中文](../zh-CN/themes.zh.md)

ParaFlow includes 11 themes from ParaFlow Classic, Typora and VNote. Select them in settings or Theme Manager.

The settings offer an experimental Typora theme importer. The source repository also includes the [paraflow-theme Skill](../../../skills/public/paraflow-theme/SKILL.md), which helps an agent inspect and adapt themes from Typora, MarkText, VNote, Zettlr, Joplin, and other CSS sources.

Click the refresh icon to the left of the theme selector to scan installed themes and reload the current theme's files. **Theme Manager** opens a separate desktop window, or a workspace tab on mobile. Search the list and filter by color scheme, package, source and installation type. Missing source information appears as “-”.

Package and standalone names align and use normal weight. Child themes indent further, and a thin border encloses each expanded package. Click a package row to expand or collapse its themes. Search and filters reveal matching children; clearing them restores the saved expansion. Sorting keeps each package together. The five bundled Typora themes form one package; ParaFlow Classic is standalone.

Click a theme row to select it; double-click to use it. Right-click for theme actions: apply, open folder, export, conversion report and theme information. In theme information, edit the source and **Package ID**: themes with the same ID group together, and an empty ID makes the theme standalone. Package rows offer expand/collapse and package information. Import and export preserve this metadata.

Click anywhere in a header cell to toggle ascending or descending order. Dragging shows a floating heading and an insertion line before or after the target; release to insert the column there, or press Esc to cancel. Alt+Left/Right moves a focused heading. The workspace saves column order, sorting and package expansion. Headers align left with separators, sorting arrows reserve their width, and management controls keep accessible names without hover tooltips.

Themes with both palettes, such as Typora GitHub, Pixyll, Whitey, and Newsprint, follow Obsidian’s active light or dark appearance, including system changes. Single-palette themes retain their own colors. Change the application’s color scheme in Obsidian Appearance settings. Theme Manager labels declared support as Dark/light, Dark or Light.

## Importing a Typora theme (experimental)

1. Click “Import theme” and choose a CSS file, ZIP archive, or theme folder.
2. Click “Preview conversion” to review mapped, approximate, and skipped rules.
3. Click “Save theme,” then select it in the theme menu to apply it.

Import directories use the theme name, such as `typora-github`. Import mainly processes local CSS and assets; remote resources are not downloaded.

Plugin upgrades update unmodified bundled theme files while retaining personal additions in `overrides.css` and directly edited base styles. For other packages, [download an adapted theme ZIP](../../../themes/README.md) and import it; an existing ID receives a numeric suffix. You can also copy a complete theme or package folder into `<vault>/.obsidian/plugins/paraflow/themes/`, keeping its manifest, members, and shared assets together, then refresh the theme list.

The conversion report helps locate individual rule and resource issues. No convertible body rules, missing required CSS imports, and invalid paths can block saving. Missing optional fonts or images are reported.

### Adjusting theme files

Use “Open theme folder” to locate the current theme. Its usual location is `paraflow/themes/<theme-id>/` or `paraflow/themes/<package-id>/<theme-id>/` under the vault's plugin directory:

| File or directory | Contents |
| --- | --- |
| `theme.json` | Theme information |
| `theme.css` | Generated styles |
| `overrides.css` | User style additions |
| `conversion-report.json` | Conversion report |
| `assets/` | Local fonts and images |
| `source/` | Imported source files |

Edit `overrides.css`, then click the refresh icon beside the theme selector. Use content element selectors, Obsidian content classes, and `:root` variables. For example:

```css
h1 { color: #225588; }
.cm-header-1 { color: #225588; }
```

Use `url(assets/filename)` for single-theme resources, or `url(../assets/filename)` for package-shared resources. Overrides support ordinary rules, `@media`, and `@supports`; font registration is handled by importing the source theme.

Overrides apply only to the content area. Check changes in Reading view and Live Preview.

### Exporting

“Export” packages an imported theme's source files, assets, overrides, and report as a ZIP. Importing an ordinary theme again runs conversion again. Packages that declare paired palettes retain their converted light and dark styles.

## Examples

Open the [showcase index](../../../dist/showcase/README.md), switch between Follow Obsidian and ParaFlow Classic, then compare an imported theme across body text, lists, tables, math, and code.
