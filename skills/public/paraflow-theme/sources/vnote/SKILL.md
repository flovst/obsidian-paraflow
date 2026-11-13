---
name: vnote
description: Interpret VNote palette references and separate its reading CSS from Qt interface styles.
---

# VNote

Look for a theme directory containing `palette.json`, `web.css`, `highlight.css`, `interface.qss` and editor `.theme` files. Reading CSS can contain `@palette#fg_reader` or `@base#content#bg` references. Check these together with source/version information.

Resolve the selected palette and its referenced values before converting reading CSS. Adapt `web.css` and the chosen highlight rules; QSS and editor theme data belong to separate consumers. Follow local font/image references. A missing palette can leave the reading colors unresolved, so request that file when needed.

Use [prepare-vnote.mjs](scripts/prepare-vnote.mjs) to resolve palette aliases before passing reading CSS to the converter. The helper follows VNote's parser syntax and rejects missing or cyclic references. Themes backed by Qt system colors require values captured from the source environment. Source: [official theme directory](https://github.com/vnotex/vnote/tree/master/src/data/extra/themes).
