# Quotes, callouts, and HTML blocks

[Documentation](../../README.md) · [中文](../zh-CN/containers.zh.md)

For containers such as quotes and callouts, ParaFlow provides:

- Structural boundary handling
- Keyboard actions and shortcuts, including Enter, Shift+Enter, and Backspace
- Paragraphs, lists, and other content within containers, with editing behavior consistent with content outside them wherever possible

The default keyboard behavior is modeled on Typora.

For HTML blocks, ParaFlow also supports rendering `<details>` and `<summary>`. See the [Tables guide](tables.en.md) for HTML tables.

## Use

### Quotes and callouts

**Creating a quote or callout**

<video src="../assets/videos/quotes-and-callouts/create-quote.mp4" controls=""></video>

Type `>` and press `Enter` to create a quote.

![A quote in Live Preview](../assets/images/image-20261028023454132.png)

Switch to Source mode and change the first line to a marker such as `> [!note]` to turn it into a callout.[^1]

[^1]: Callouts use Obsidian-specific syntax. Other editors generally display them as ordinary quotes.

**Editing within a container**

<video src="../assets/videos/quotes-and-callouts/edit-callout.mp4" controls=""></video>

Containers can include multiple paragraphs, nested lists, and other content.

**Folding a callout**

![A collapsible callout](../assets/images/image-20261028024211000.png)

Use the folding control on a collapsible callout to expand or collapse its body.

**Callout styles**

![Obsidian-style callouts](../assets/images/image-20261028024310744.png)

Alongside the Typora-style callouts shown above, the settings also offer an Obsidian-style appearance.

### HTML support

<video src="../assets/videos/html/details.mp4" controls=""></video>

ParaFlow provides source editing and previews for HTML blocks such as `<div>` and `<details>`. A `<details>` block can also contain ordinary Markdown content. Use `Ctrl+Click` to edit its summary.

## Settings

Under **Settings → ParaFlow → Editing**, toggle **Quotes & callouts** and **HTML preview** independently. The current [content theme](themes.en.md) controls text styling within containers.

In the **Quotes & callouts** settings group, choose the `default` vertical rule style or the `obsidian` style with a block background. Both styles share title editing, folding, and click behavior.

Under **HTML preview**, toggle **Details hover background**. When enabled, the whole disclosure region fades in a translucent background as the pointer enters, preserving its enclosing callout's background color.

To inspect structure, switch to Source mode and check quote prefixes, callout types, and HTML tags. Use the corresponding HTML markup when editing HTML content.

## Examples

- [Lists, quotes, and callouts showcase](../../../dist/showcase/features/Lists%20quotes%20and%20callouts.en.md): paragraphs and lists within quotes, plus ordinary and collapsible callouts.
- [Markdown syntax showcase](../../../dist/showcase/Markdown%20syntax%20showcase.en.md): combinations with body text and other Markdown content.
