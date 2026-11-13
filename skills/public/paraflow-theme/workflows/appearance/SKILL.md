---
name: appearance
description: Pair light/dark palettes or generate a counterpart when the user explicitly requests it, preserving shared layout.
---

# Light/dark adaptation

Use this module when the user explicitly requests pairing, adaptation or counterpart generation. A single-mode import calls for a brief suggestion after import; wait for the user's request before changing or generating variants.

Prefer an author's existing pair. Compare semantic colors and component states, and preserve attribution. Read a source module when the input still requires software-specific preparation. Commands below run from this module directory with Node.js 20+.

## One geometry, two palettes

1. Inventory actual foreground/background paint: body, muted text, H1–H6, links, quote, inline code, code blocks and syntax tokens, table/header/stripe/borders, highlight/selection, math and diagrams. Resolve `var()` and composite alpha colors on the background where used. Preserve gradients, image-based decoration and authored inline colors as separate review items.
2. Factor these colors into named semantic variables. Keep fonts, margins, padding, widths, line heights, decorations and editor interaction rules shared. Preserve images and math when changing the palette.
3. If the author provides a counterpart, use its semantic colors. Otherwise generate a **draft** with `scripts/derive-palette.mjs`, using opaque six-digit hex colors for the required roles:

```json
{
  "background": "#fdf6e3", "text": "#657b83", "muted": "#586e75",
  "surface": "#eee8d5", "border": "#93a1a1", "link": "#268bd2",
  "codeText": "#657b83", "codeBackground": "#eee8d5"
}
```

```sh
node scripts/derive-palette.mjs --input light-palette.json --from light --output generated-dark.json
```

The helper preserves OKLab hue direction, adjusts role lightness and fits sRGB. It checks foreground contrast against the specified backgrounds at 4.5:1 or above. Optional H1–H6, highlight and selection roles are supported. Use `--from dark` for a light draft. Review the output's `palette` object and keep its generated-draft label and provenance.

4. Integrate reviewed palettes into a single ParaFlow package. Set manifest `colorScheme` to `adaptive` and append **already scoped** palette branches to generated `theme.css`. Use the host's `body.theme-dark`/`body.theme-light` classes so Obsidian's choice governs the result. OS `prefers-color-scheme` alone can disagree with Obsidian. For example, for an existing `my-theme` package:

```css
body[data-paraflow-theme="my-theme"] :is(.markdown-reading-view,.markdown-source-view.mod-cm6:not(.cm-table-widget *)) {
  --adapt-background: #fdf6e3;
  --adapt-text: #657b83;
  --paraflow-color-scheme: light;
  --paraflow-content-background: var(--adapt-background);
  --paraflow-content-color: var(--adapt-text);
  --background-primary: var(--adapt-background);
  --text-normal: var(--adapt-text);
}
body.theme-dark[data-paraflow-theme="my-theme"] :is(.markdown-reading-view,.markdown-source-view.mod-cm6:not(.cm-table-widget *)) {
  --adapt-background: #002b36;
  --adapt-text: #839496;
  --paraflow-color-scheme: dark;
}
```

This illustrates body colors only. Bind every inventoried painted color to its semantic role in the existing converted rules, including code/syntax, tables, borders and diagrams; otherwise hardcoded light declarations remain. Use the runtime's actual content roots/exclusions when writing the full package. Keep these conditional branches out of `overrides.css`: its current scoper prefixes arbitrary selectors below content roots, so a `body.theme-dark` override would point at an impossible descendant. Source receives readable palette tokens; rendered heading decorations belong only to Reading/Live Preview.

5. Follow [validation](../../references/validation.md) for light → dark → light, geometry and actual painted colors.

Check visual balance before adding a generated variant to bundled themes.
