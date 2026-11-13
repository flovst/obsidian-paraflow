---
name: zettlr
description: Extract Zettlr editor theme variables and styles for ParaFlow content adaptation.
---

# Zettlr

Built-in editor themes use TypeScript, `EditorView.theme`, `--zettlr-editor-*` variables and shared light/dark defaults. The application namespace and imports are useful clues; CodeMirror's API alone is shared across applications.

Inspect the theme and imported defaults as data. Extract the effective colors, fonts and relevant content rules, then map them to ParaFlow's rendered/editor surfaces. Keep the light/dark relationship and separate syntax highlighting. Read supplied source files without executing a theme's JavaScript or TypeScript.

Use [the static data reader](scripts/read-zettlr-data.mjs) for literal constants, identifiers, object properties and object spreads. Pass reviewed imported default objects explicitly; its `theme()` reader inspects `EditorView.theme`/`baseTheme` arguments as data. Calls, computed keys and other expressions fail explicitly. Resolve referenced global CSS variables from the supplied version's `WindowChrome.vue` color definitions. Retain shared `editor.ts`, `code.ts`, font definitions and licenses with the original theme.

User-provided CSS may follow another structure; choose the path from the actual entry. Source: [official editor themes](https://github.com/Zettlr/Zettlr/tree/develop/source/common/modules/markdown-editor/theme/themes).
