# Content themes

[Documentation](../README.md) · [中文](themes.zh.md)

ParaFlow content themes adjust note typography, colors, and layout, and support importing Typora themes. Open **Settings → ParaFlow → Theme** to manage them.

## Choosing and adjusting a theme

- **Follow Obsidian:** use Obsidian's fonts and colors with ParaFlow's basic markers and layout.
- **ParaFlow Classic:** use the body styles supplied by the plugin.
- **Typora GitHub:** use the bundled GitHub content theme. Its source files and fonts are installed with the theme.
- **Imported themes:** use converted Typora content styles, with one theme selected at a time.

Text font, size, content width, line height, and accent color can use theme defaults, follow Obsidian, or use custom values. Adjustments are saved separately for each theme and retained when switching themes. “Reset theme adjustments” clears local adjustments for the current theme.

Content width follows Obsidian's line-width settings when that option is selected. Custom width uses pixels, and line height uses a multiplier. Body text size primarily affects paragraphs and lists; headings, code, and other content with explicit sizes retain their corresponding styles.

Metadata can align with the body or use Obsidian's layout, with controls for horizontal padding and space below it. Property visibility is controlled by **Obsidian Settings → Editor → Properties in document**.

Themes apply to Live Preview and Reading view. Source view shares some text and layout styles; see [Views](views-and-clipboard.en.md).

## Importing a Typora theme

1. Click “Import theme” and choose a CSS file, ZIP archive, or theme folder. Keep the complete resources when a theme includes fonts, images, and `@import` files.
2. If several entries are available, choose the CSS entry to convert and enter a theme name.
3. Click “Preview conversion” to review mapped, approximate, and skipped rules.
4. Click “Save theme,” then select it in the theme menu to apply it.

Import processes local CSS and assets; remote resources are not downloaded. Conversion primarily covers fonts, colors, headings, links, code, quotes, tables, and content width. Rules tied to Typora-specific interface or DOM structures may be skipped.

The conversion report helps locate individual rule and resource issues; its counts are not a compatibility percentage. No convertible body rules, missing required CSS imports, and invalid paths can block saving. Missing optional fonts or images are reported.

Imported themes retain their converted colors. The color scheme control does not generate separate light and dark versions for them. Supported conditional styles in the source CSS are preserved.

## Adjusting theme files

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

## Exporting

“Export” packages an imported theme's source files, assets, overrides, and report as a ZIP. Importing it again runs conversion again. Local font, width, and similar adjustments from the theme settings are stored separately in plugin settings and are excluded from the theme export.

## Examples

Open the [showcase index](../../showcase/README.md), switch between Follow Obsidian and ParaFlow Classic, then compare an imported theme across body text, lists, tables, math, and code.
