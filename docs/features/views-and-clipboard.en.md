# Views, copying, and pasting

[Documentation](../README.md) · [中文](views-and-clipboard.zh.md)

ParaFlow provides editing enhancements in Live Preview, content styling in Reading view, and editing aids such as line numbers and whitespace display in Source view.

## Switching and inspecting

Edit in Live Preview, switch to Reading view to see rendering, or switch to Source view to inspect Markdown. Content themes apply to Live Preview and Reading view; Source view shares fonts, colors, width, and heading text styles while retaining source markers.

Under **Settings → ParaFlow → Editing → Source view**, adjust active-line highlighting, whitespace, indent guides, newline markers, and line numbers.

Line numbers can show every line or only every tenth line and the active line, positioned at the editor's left edge or the body's left edge. Source tab width ranges from 1 to 8 character columns and affects source display only.

Newline markers use `↵` for ordinary source newlines and `↴` for Markdown hard breaks ending in two spaces. Soft wrapping and an end of file without a newline have no marker.

## Copying and pasting

When copying selected Markdown content, ParaFlow preserves its source representation. Paste into Source view to inspect markers, indentation, and blank lines.

Under **Editing → Copy & paste**, choose separate paste modes for Source view and Live Preview:

| Mode | Behavior |
| --- | --- |
| Exact text | Preserve the original text representation available from the clipboard |
| Smart paste | Use Obsidian's rich-text conversion and attachment handling |

Source view defaults to Exact text, and Live Preview defaults to Smart paste. The command palette's **本次精确粘贴 / Paste exact text** and **本次智能粘贴 / Smart paste** commands override a single operation without changing the defaults. This group also provides “Complete code fences.”

Other plugins may also handle clipboard operations. If results differ, try the two paste commands with the same text to compare their behavior.

## Related settings and examples

**Mouse and selection** offers controls to prevent dragging selected text and hide the caret while drag-selecting. For source cleanup when changing modes, see [Lists and tasks](lists.en.md).

Use the [Markdown syntax showcase](../../showcase/Markdown%20syntax%20showcase.en.md) to compare the three views and try copying formatted text, lists, and code.
