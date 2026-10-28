# Markdown and HTML tables

[Documentation](../../README.md) · [中文](../zh-CN/tables.zh.md)

ParaFlow provides Typora-like table styling and a floating toolbar, along with HTML table support, including merged cells. It offers cell editing, row and column operations, alignment, and merging. Display enhancements include automatic layout, alternating rows, and overflow handling.

## Use

<video src="../assets/videos/table/edit-table.mp4" controls=""></video>

For Markdown tables, the main additions are visual improvements and a toolbar above the table:

- **Display:** alternating rows, automatic layout, and automatic width adjustments.
- **Keyboard shortcuts:**
  - `Alt+Arrow keys`: move a row or column.
  - `Ctrl+Enter`: add a row.
  - `Ctrl+Shift+Backspace`: delete the current row.
- **Floating toolbar:**
  - Adjust the number of rows and columns.
  - Change horizontal and vertical alignment.
  - Identify and convert between Markdown and HTML tables.
  - Access deletion and additional actions.

### HTML tables

ParaFlow supports HTML table editing, keeping the experience consistent with Markdown tables wherever possible.

<video src="../assets/videos/table/merge-cell.mp4" controls=""></video>

HTML table support includes:

- Vertical alignment.
- Merging and splitting cells, with behavior modeled mainly on Excel.
- Conversion of supported Markdown tables to standard HTML when applying formatting that requires HTML, such as vertical alignment.
- HTML table source formatting.

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

The [Markdown and HTML tables showcase](../../../dist/showcase/features/Markdown%20and%20HTML%20tables.en.md) includes horizontal and vertical alignment, long text, spanning cells, and HTML cell formatting.
