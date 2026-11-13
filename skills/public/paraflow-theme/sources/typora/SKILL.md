---
name: typora
description: Interpret Typora theme entries, selectors and local resources for ParaFlow conversion.
---

# Typora

Themes use an entry CSS plus optional imported CSS, fonts and images. Use the original entry with ParaFlow's existing Typora import path. Read its local dependencies when referenced.

Source clues include `#write`, `.md-fences`, `.md-meta`, `.typora-*`, `[mdtype]` and variables such as `--bg-color`, `--text-color`, `--md-char-color`. Evaluate the combination with package provenance; copied selectors and generic variable names also occur in ports.

Preserve standard Markdown rules and translate Typora-specific content selectors. Separate sidebar/dialog rules from content. Review code highlighting, focus/edit states and print branches against their actual consumers. Fonts and URLs stay relative to the original entry until packaging resolves them.

For a CSS inventory, use the root `scripts/inspect-css.mjs`; this path needs no MarkText preprocessing. Details: [official theme guide](https://theme.typora.io/doc/Write-Custom-Theme/).
