# Code blocks and Mermaid

[Documentation](../README.md) · [中文](code-blocks.zh.md)

ParaFlow provides line numbers, wrapping, a language control, and syntax palettes for code blocks, along with fence boundary handling, navigation, and selection within a block.

## Use

Create a fenced code block with three backticks and add a language name such as `ts` after the opening fence. Edit code in Live Preview and use the language control to adjust the language.

Displayed line numbers help locate code. Copying a code block preserves indentation and blank lines while excluding the displayed line numbers. Long lines can wrap or be viewed horizontally.

Mermaid diagrams have a separate toggle for source editing and preview. Write a diagram in a `mermaid` fence, then view its preview.

## Settings

Under **Settings → ParaFlow → Editing → Code blocks**, adjust wrapping, line numbers, language control position, and syntax colors.

The language control can appear at the top right, bottom right, or be turned off. Syntax colors can follow Obsidian or use One Light, Solarized, or Light+; the latter three suit light backgrounds. Palette selection preserves language detection, code content, and the block background.

**Editing → Mermaid diagrams** controls diagram enhancements. **Copy & paste → Complete code fences** controls the related paste aid. See [Views, copying, and pasting](views-and-clipboard.en.md) for paste modes.

## Examples

- [Math and code blocks showcase](../../dist/showcase/features/Math%20and%20code%20blocks.en.md): syntax highlighting, long lines, blank lines, indentation, and copying.
- [Markdown syntax showcase](../../dist/showcase/Markdown%20syntax%20showcase.en.md): code alongside other syntax.
