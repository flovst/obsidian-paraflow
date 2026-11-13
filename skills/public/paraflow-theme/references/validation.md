# Validate the affected content

Compare a short representative note in Reading and Live Preview: headings, wrapped/nested lists, quote/callout, code, table and math. Check the repaired element at normal and narrow widths. Confirm Source readability, local assets and host UI isolation.

For paired modes, switch Obsidian light → dark → light. Check color restoration, geometry, syntax colors, selection/highlight and translucent overlays. When checking generated colors, measure contrast on the actual background; use at least 4.5:1 for ordinary text and evaluate large text separately.

Keep note source and selection stable when changing appearance. Editing interactions need source/selection and Undo checks when the change affects them. State whether verification used an isolated browser or native Obsidian. If application control is unavailable, give the exact remaining visual check.
