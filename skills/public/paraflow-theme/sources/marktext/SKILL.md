---
name: marktext
description: Interpret MarkText base styles, theme tokens and Muya content, and prepare its palette for ParaFlow.
---

# MarkText

Typical clues are `--editorBgColor`, `--editorColor`, `--codeBlockBgColor` and kebab-case aliases, combined with Muya `.mu-*` or older `.ag-*` selectors. Theme CSS may only override a base palette. Verify the supplied version and package structure.

For the current monorepo layout, inspect these inputs as needed:

- Renderer `assets/styles/index.css`: base values, including default Light.
- `assets/themes/<id>.theme.css`: selected overlay.
- Muya `assets/styles/blockSyntax.css`: content layout and variable consumers.
- `themeColor.ts` and matching Prism CSS: rendered syntax colors; some variants share files. Source-mode CodeMirror colors are selected separately.

Paths vary by version. Use supplied files and record the revision. For a palette-only preparation, run from this module directory with Node.js 20+ and css-tree 3.x:

```sh
node scripts/prepare-marktext.mjs --base index.css --theme solarized-light.theme.css --output NEW-content.css --report NEW-report.json
```

The helper merges unconditional `:root` declarations, resolves aliases and `var()` dependencies, respects `!important`, and reports conflicts, missing roles and ignored rules. Outputs are fresh files. For default Light, use the base and an empty local overlay.

Import the prepared CSS through ParaFlow's CSS conversion path. Typography, spacing, Prism and assets require explicit adaptation from their source files; the helper transfers semantic colors. Review the downstream report: `::selection` currently needs a separate scoped override. Keep MarkText toolbar/sidebar rules outside content.

Muya uses `--highlightColor` / `--highlight-color` for search matches (`.mu-highlight`), so the helper does not treat these as Markdown or HTML `mark` colors. Check authored `mark` rules separately; the current default themes leave raw HTML `mark` at Chromium's black text and yellow background.

Paired references include Solarized, Ayu, Catppuccin, Everforest, Gruvbox, Rosé Pine and Tokyo Night. Use [Appearance](../../workflows/appearance/SKILL.md) when the user requests pairing. Source: [MarkText assets](https://github.com/marktext/marktext/tree/develop/packages/desktop/src/renderer/src/assets).
