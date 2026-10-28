# Views, copying, and pasting

[Documentation](../../README.md) · [中文](../zh-CN/views-and-clipboard.zh.md)

ParaFlow enhances all three Obsidian views:

- **Live Preview:** the main focus of the editing enhancements. See the other feature guides for individual syntax types.
- **Reading view:** aims to match Live Preview, with a few differences such as hiding Obsidian comments and omitting empty lines.
- **Source mode:** provides editing aids such as line numbers, active-line highlighting, syntax highlighting, and whitespace display. Content that cannot be edited in Live Preview can be changed here.

## Switching and inspecting

<video src="../assets/videos/views/change-view.mp4" controls=""></video>

The video demonstrates switching between the three views with keyboard shortcuts:

- `Ctrl+E`: Live Preview ↔ Reading view.
- `Ctrl+/`: Live Preview ↔ Source mode.

Reading view and Live Preview look almost identical in this example. Source mode follows Typora's general appearance, with adjusted theme colors.

## Copying and pasting

By default, Live Preview uses Smart paste and completes boundaries for content such as code and math blocks. Source mode uses Exact text to preserve the original characters when copying and pasting.

Configure this under **Editing → Copy & paste**:

| Mode | Behavior |
| --- | --- |
| Exact text | Preserve the original text representation available from the clipboard |
| Smart paste | Use Obsidian's rich-text conversion and attachment handling |

## Related settings and examples

**Mouse and selection** offers controls to prevent dragging selected text and hide the caret while selecting. For source cleanup when changing modes, see [Lists and tasks](lists.en.md).

Use the [Markdown syntax showcase](../../../dist/showcase/Markdown%20syntax%20showcase.en.md) to compare the three views and try copying formatted text, lists, and code.
