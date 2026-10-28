# Code blocks and Mermaid

[Documentation](../../README.md) · [中文](../zh-CN/code-blocks.zh.md)

ParaFlow provides these code block enhancements:

- Fence marker handling
- Line numbers
- Word wrapping for long lines
- A control for changing the code block language
- Syntax color palettes
- Improved selection and copying

For Mermaid diagrams, it offers a Typora-like editing experience: click a diagram to reveal its source.

## Use

### Code blocks

**Creating a code block**

<video src="../assets/videos/codeblock/create.mp4" controls=""></video>

Once a code block is created, its triple-backtick fences are hidden. Change the language using the floating control at the bottom right, or press `Ctrl+/` to edit it in Source mode:

![Code block language control and source editing](../assets/images/image-20261028020205826.png)

In Source mode, code blocks have a darker background to distinguish them visually.

**Word wrapping**

![A long code line with horizontal scrolling](../assets/images/image-20261028020559434.png)

Normally, a long line in a code block produces a horizontal scrollbar. Enable **Editing → Code blocks → Wrap long lines** to display it across multiple visual lines:

![A long code line with wrapping enabled](../assets/images/image-20261028020754391.png)

This works similarly to Word Wrap in VS Code.

### Mermaid

![A centered Mermaid diagram](../assets/images/image-20261028021205541.png)

Mermaid diagrams are centered by default, with a hover highlight showing their boundaries:

![Mermaid diagram hover highlight](../assets/images/image-20261028021405558.png)

Click a diagram to reveal its source and a live preview:

![Mermaid source editing with live preview](../assets/images/image-20261028021458178.png)

## Settings

Under **Settings → ParaFlow → Editing → Code blocks**, adjust wrapping, line numbers, language control position, and syntax colors.

The language control can appear at the top right, bottom right, or be turned off. Syntax colors can follow Obsidian or use One Light, Solarized, or Light+; the latter three suit light backgrounds. Palette selection preserves language detection, code content, and the block background.

**Editing → Mermaid diagrams** controls diagram enhancements. **Copy & paste → Complete code fences** controls the related paste aid. See [Views, copying, and pasting](views-and-clipboard.en.md) for paste modes.

## Examples

- [Math and code blocks showcase](../../../dist/showcase/features/Math%20and%20code%20blocks.en.md): syntax highlighting, long lines, blank lines, indentation, and copying.
- [Markdown syntax showcase](../../../dist/showcase/Markdown%20syntax%20showcase.en.md): code alongside other syntax.
