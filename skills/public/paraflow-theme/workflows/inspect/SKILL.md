---
name: inspect
description: Inspect a theme's source, dependencies or displayed differences before choosing a conversion or repair.
---

# Inspect a theme

Use the supplied source software, download URL and version alongside the package structure. Read that software's source module. If the source is unclear, inspect the entry and adjacent metadata first, then read the plausible modules. For a CSS inventory, run from the theme skill root with Node.js 20+ and css-tree 3.x:

```sh
node scripts/inspect-css.mjs entry.css
```

The helper lists selectors, custom-property declarations, imports and URLs with file positions. The agent chooses the adapter using these facts and source documentation. Theme names, ordinary Markdown elements, Prism and CodeMirror alone do not identify an application. A package can contain several ports; inspect the selected entry and its dependencies together.

When the choice affects conversion, ask for the software/version or download address in one question. If unavailable, state the chosen interpretation and likely missing effects, then continue the requested conversion where the inputs support it. Identify missing base files or assets separately.

For a displayed defect, compare a small note with the selected theme and mode. Trace the affected selector, variable or asset, then use [Convert](../convert/SKILL.md) for the repair. Keep the report to the source decision, required inputs and actionable differences.
