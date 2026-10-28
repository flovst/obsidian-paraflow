# Lists and tasks

[Documentation](../../README.md) · [中文](../zh-CN/lists.zh.md)

ParaFlow provides item creation, splitting, indentation, and nesting controls for unordered lists, ordered lists, and task lists. Editing the content preserves the list's formatting and indentation.

> Another of the best features in Typora.

## Use

Edit a list in Live Preview:

<video src="../assets/videos/list/edit-list.mp4" controls=""></video>

ParaFlow manages list marker appearance and indentation, so everyday editing keeps the structural source out of the way. Switch to Source mode when you need to edit it directly.

Keyboard behavior closely follows Typora:

- **Enter:** create a sibling item. When the current item is empty, remove its marker or adjust its indentation.
- **Shift+Enter:** add a new paragraph within the same list item.
- **Tab / Shift+Tab:** increase or decrease list indentation.

Task lists use Obsidian's shortcut: press `Ctrl+Enter` to create a task.

## Settings

Enable or disable list editing under **Settings → ParaFlow → Editing → Lists & tasks**. Unordered list markers can vary by nesting level or use a fixed shape; this changes their appearance.

**Editing → Misc → Automatic source cleanup** offers four options: Never, On manual save, On view change, and On manual save or view change.

- Manual save: press `Ctrl+S` in the main editor to supplement list continuation indentation and missing zero-width separators whose ownership was established during editing. Autosave and the Save menu do not trigger this document scan.
- View change: when switching the same file between Live Preview, Source, and Reading views with an editor available, supplement structural indentation. This operation only adjusts indentation.
- Cleanup changes can be undone. A scan that makes no changes adds no undo entry.

This setting mainly helps maintain structural whitespace, such as the spaces before list markers.

## Source separators

Structured editing may insert an invisible **U+200B zero-width space (ZWSP)** into Markdown to distinguish indentation from ordinary spaces in the body. Typora also supports this representation. Live Preview hides and protects managed prefixes; Source mode lets you inspect these characters.

## Examples

The [Lists, quotes, and callouts showcase](../../../dist/showcase/features/Lists%20quotes%20and%20callouts.en.md) contains unordered, ordered, task, and nested lists, plus continuation lines and additional paragraphs within items.
