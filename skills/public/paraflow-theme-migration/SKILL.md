---
name: paraflow-theme-migration
description: Use when a ParaFlow user wants to import or adapt a locally supplied Typora content theme, inspect conversion differences and verify the result in Obsidian.
---

# Migrate a local Typora theme

Use the user's supplied CSS, ZIP or theme folder and a vault they authorize for this task. Do not search unrelated vaults, upload theme contents or download missing resources automatically. Redistribution requires the theme/resource license; permission to use a theme is not permission to redistribute it.

1. Identify the entry CSS and local imports, fonts and images. Prefer a complete folder/ZIP when there are dependencies. Record the previous ParaFlow content-theme selection for rollback.
2. In Obsidian's ParaFlow settings, choose **Import Typora theme**, select the entry and name, then **Preview conversion**. Inspect mapped, approximated, skipped and missing-resource results. Mapping counts are not a compatibility percentage.
3. Save the imported theme, then explicitly select it. Importing does not replace the whole Obsidian application theme or automatically activate the new entry.
4. Compare a short representative note in Live Preview and Reading: headings, wrapped/nested lists, quote/callout, code, table and math. Check light/dark surroundings and narrow width. Source view keeps source readable; it is not expected to reproduce rendered content.
5. Fix concrete visual differences through the theme's `overrides.css` and **Reload**. Use content selectors or `:root` variables; ParaFlow applies content scope. Avoid changing editor geometry/ownership to imitate appearance.
6. Recheck affected examples and report supported results and remaining differences. Use the built-in theme export only when the resources may be shared. Remove machine paths or private source labels before distributing a package.
7. To roll back, reselect the previous content theme. Preserve user overrides. Do not delete a theme directory while it is active.

Imported themes normally live under the plugin's configured directory at `themes/<id>/`, with generated CSS, overrides, source, assets and a conversion report. Custom Obsidian configuration directories are supported; use the actual plugin location instead of assuming a global path.

Do not promise pixel parity for Typora-specific menus, decorations, private DOM or print output. If application control is unavailable, give the exact remaining user steps and label visual validation as pending.
