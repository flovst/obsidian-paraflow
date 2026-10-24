# Quotes, callouts, and HTML blocks

[Documentation](../README.md) · [中文](containers.zh.md)

ParaFlow manages structural markers for quotes and callouts, displays callout titles, icons, and folding controls, and supports paragraph and list editing inside these containers.

## Use

In Live Preview, edit a quote beginning with `>` or a callout beginning with a marker such as `> [!note]`. ParaFlow preserves the corresponding `>` prefixes when editing and splitting lists inside the container.

Containers can include multiple paragraphs, nested lists, and task lists. See [Lists and tasks](lists.en.md) for list operations and [Paragraphs and line breaks](paragraphs.en.md) for paragraph display. Use the folding control on a collapsible callout to expand or collapse its body.

HTML preview provides source editing and previews for HTML blocks such as `<div>` and `<details>`. HTML tables use the separate [Tables feature](tables.en.md).

## Settings

Under **Settings → ParaFlow → Editing**, toggle **Quotes & callouts** and **HTML preview** independently. The current [content theme](themes.en.md) controls text styling within containers.

To inspect structure, switch to Source view and check quote prefixes, callout types, and HTML tags. Use the corresponding HTML markup when editing HTML content.

## Examples

- [Lists, quotes, and callouts showcase](../../showcase/features/Lists%20quotes%20and%20callouts.en.md): paragraphs and lists within quotes, plus ordinary and collapsible callouts.
- [Markdown syntax showcase](../../showcase/Markdown%20syntax%20showcase.en.md): combinations with body text and other Markdown content.
