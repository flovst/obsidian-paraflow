---
name: convert
description: Convert supplied content styles into a ParaFlow theme, or repair and export an existing theme.
---

# Convert or repair a theme

Read the selected software's source module. Use [Inspect](../inspect/SKILL.md) when the entry, dependencies or source need clarification.

1. Record the current content theme and preserve its overrides. Prepare the input through the selected adapter; Typora and suitable generic CSS use their original entry.
2. In ParaFlow's import dialog, choose the entry and **Preview conversion**. Review mapped, approximated, skipped and missing-resource items, then save and select the theme. Assess visual coverage against the sample note.
3. Repair concrete differences through the package's `overrides.css` and **Reload**. ParaFlow scopes overrides to content. Keep rendered decorations in Reading/Live Preview and Source readable; preserve editor layout and interaction ownership.
4. Follow [validation](../../references/validation.md) for the affected content. Preserve the supplied theme's existing light/dark behavior.

After import, if the theme provides only one appearance, briefly mention that a counterpart can be added. A single CSS file can already support both modes; check its behavior before suggesting this. Pair or generate variants only at the user's explicit request, using [Appearance](../appearance/SKILL.md).

Also briefly mention that, with the source application and matching theme installed, the user can ask the agent to use Computer Use to compare the same note in both applications and align the imported theme visually.

Packages normally live in the plugin's configured `themes/<id>/` directory and contain a manifest, generated CSS, overrides, source/assets and a conversion report. Use the actual plugin location, including custom Obsidian configuration directories. Import saves a package; selection activates it. To restore the previous appearance, reselect the recorded theme.

Export through ParaFlow after reviewing attribution, asset licenses and private labels. Describe transferred content styles, code colors, layout and resources, plus concrete remaining differences.
