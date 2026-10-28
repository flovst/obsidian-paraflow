# Paragraphs, line breaks, and headings

[Documentation](../../README.md) · [中文](../zh-CN/paragraphs.zh.md)

In Live Preview, ParaFlow displays a single blank line between paragraphs as non-editable paragraph spacing. Multiple consecutive blank lines remain available as editable empty paragraphs.

> One of the best features in Typora, and the starting point for this plugin (Paragraph-Flow).

Paragraph layout also offers first-line indentation, paragraph spacing, and tab display controls.

## Use

### Paragraphs and line breaks

<video src="../assets/videos/paragraph/paragraph.mp4" controls=""></video>

The default behavior is:

- **Enter:** insert two newlines.
- **Shift+Enter:** insert one newline.

A single blank line between paragraphs is rendered as non-editable paragraph spacing. Typically, two consecutive blank lines become one editable empty line.

### Headings

<video src="../assets/videos/paragraph/heading.mp4" controls=""></video>

As in Typora, a heading keeps its formatting during subsequent editing. To change its level, use a shortcut such as `Ctrl + num`, or edit the markers in Source mode.

## Settings

Open **Settings → ParaFlow → Editing**:

| Setting | Purpose |
| --- | --- |
| Paragraph & line-breaking | Enable paragraph spacing and line-break editing |
| HTML break markers | Show hints for tags such as `<br>` |
| Indent first line | Adjust the display of the first line of body paragraphs |
| Paragraph spacing | Adjust the distance between paragraphs |
| Tab display, Tab width | Choose fixed width or tab stops and set their width |
| Headings | Enable heading marker and editing behavior |

First-line indentation, paragraph spacing, and tab display affect layout while preserving source characters. Body tab width uses spaces in the current content font; Source mode has a separate tab setting.

## Examples

Open the [Markdown syntax showcase](../../../dist/showcase/Markdown%20syntax%20showcase.en.md) to compare paragraphs, headings, blank lines, and line breaks. For continuation lines and paragraphs inside lists, see [Lists and tasks](lists.en.md).
