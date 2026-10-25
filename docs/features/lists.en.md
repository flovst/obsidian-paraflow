# Lists and tasks

[Documentation](../README.md) · [中文](lists.zh.md)

ParaFlow provides item creation, splitting, indentation, and nesting controls for unordered lists, ordered lists, and Markdown task lists.

## Use

Edit a list in Live Preview:

| Action | Purpose |
| --- | --- |
| Enter | Split the current item or create the next item |
| Shift+Enter | Add a continuation line within an item |
| Tab / Shift+Tab | Increase or decrease indentation at applicable list positions |
| Click a task checkbox | Toggle the task state |
| Undo | Revert an edit or task state change |

Nested lists retain the relationship between items and their children. Lists inside quotes and callouts use the same operations while preserving container prefixes. Source view lets you inspect indentation, task markers, and continuation lines.

## Settings

Enable or disable list editing under **Settings → ParaFlow → Editing → Lists & tasks**. Unordered list markers can vary by nesting level or use a fixed shape; this changes their appearance.

**Editing → Misc → Automatic source cleanup** offers four options: Never, On manual save, On view change, and On manual save or view change.

- Manual save: press `Ctrl+S` in the main editor to supplement list continuation indentation and missing zero-width boundaries whose ownership was established during editing. Autosave and the Save menu do not trigger this document scan.
- View change: when switching the same file between Live Preview, Source, and Reading views with an editor available, supplement structural indentation. This operation only adjusts indentation.
- Cleanup changes can be undone. A scan that makes no changes adds no undo entry.

## Source separators

Structured editing may insert a **U+200B zero-width space** into Markdown to preserve boundaries between paragraphs and lists. This is an actual character in the file. Live Preview hides and protects managed prefixes; Source view lets you inspect these characters.

Automatic source cleanup controls additional cleanup triggers; normal editing still inserts required boundaries immediately. When cleaning source, inspect individual positions before removing U+200B characters throughout a file.

## Examples

The [Lists, quotes, and callouts showcase](../../dist/showcase/features/Lists%20quotes%20and%20callouts.en.md) contains unordered, ordered, task, and nested lists, plus continuation lines and additional paragraphs within items.
