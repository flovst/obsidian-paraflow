# Markdown and HTML tables

[Documentation](../README.md) · [中文](tables.zh.md)

ParaFlow provides cell editing, row and column operations, alignment, and merging for Markdown and HTML tables. Enhanced display includes automatic layout, alternating rows, and overflow handling.

## Use

Activate a table cell in Live Preview, then use table controls to edit content, add or delete rows and columns, and adjust alignment. With text wrapping enabled, long content wraps to the column width; otherwise, wide tables scroll horizontally.

HTML tables support `rowspan` and `colspan`. Merging cells keeps only the upper-left cell's content, so check the text in the selected cells before merging.

When applying formatting that requires HTML, such as vertical alignment, ParaFlow converts a supported Markdown table to standard HTML. Switch to Source view to inspect the result, and use one Undo to restore the table before that conversion.

Use HTML tags such as `<strong>`, `<em>`, `<code>`, and `<br>` for formatting and line breaks inside HTML cells. Rendering arbitrary Markdown nested within HTML cells is outside the supported scope.

## Settings

Open **Settings → ParaFlow → Editing → Tables**:

| Setting | Purpose |
| --- | --- |
| Enhanced display | Automatic layout, alternating rows, and overflow handling |
| Enhanced editing | Cell operations, merging, formatting, and HTML conversion |
| Wrap cell text | Switch between wrapping and horizontal scrolling for wide tables |
| Warn before discarding merged content | Restore the warning about discarding other cells' content during merging |

Enhanced display and editing can be enabled independently. The [content theme](themes.en.md) provides table colors, borders, and fonts.

## Examples

The [Markdown and HTML tables showcase](../../showcase/features/Markdown%20and%20HTML%20tables.en.md) includes horizontal and vertical alignment, long text, spanning cells, and HTML cell formatting.
