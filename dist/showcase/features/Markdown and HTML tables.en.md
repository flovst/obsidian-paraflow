# Markdown and HTML tables

[Showcase index](../README.md) · [中文](Markdown%20and%20HTML%20tables.zh.md)

This note covers cell editing, row and column operations, alignment, and spanning cells in Markdown and HTML tables.

## Markdown tables

The three columns use left, center, and right alignment. Edit a cell or use the table controls to add and remove rows and columns.

| Left aligned    | Centered | Right aligned |
| :-------------- | :------: | ------------: |
| First-row text  |    A     |           100 |
| Second-row text |    B     |           200 |
| Third-row text  |    C     |           300 |

## Long text and inline formatting

| Format            | Content                                                                                                                                                                           |
| :---------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bold text**     | This long cell text shows wrapping, row height, and cell padding as the column width changes. Narrowing the editor makes this text occupy more visual lines within the same cell. |
| *Italic text*     | Regular text in the second row.                                                                                                                                                   |
| `inline code`     | Regular text in the third row.                                                                                                                                                    |
| ~~Strikethrough~~ | Regular text in the fourth row.                                                                                                                                                   |

## HTML tables and vertical alignment

The first row contains a multiline cell and short text aligned to the top, middle, and bottom.

<table>
<thead>
<tr><th>Multiline content</th><th>Top aligned</th><th>Middle aligned</th><th>Bottom aligned</th></tr>
</thead>
<tbody>
<tr><td>First line<br>Second line<br>Third line</td><td style="vertical-align: top;">Top</td><td style="vertical-align: middle;">Middle</td><td style="vertical-align: bottom;">Bottom</td></tr>
<tr><td>Regular cell</td><td>A</td><td>B</td><td>C</td></tr>
</tbody>
</table>

After setting vertical alignment in a Markdown table, inspect the converted HTML in Source view and use Undo to check restoration.

## Cells spanning rows and columns

This table contains one cell spanning two rows and another spanning two columns.

<table>
<thead>
<tr><th>Column one</th><th>Column two</th><th>Column three</th></tr>
</thead>
<tbody>
<tr><td rowspan="2">Spans two rows</td><td>R1C2</td><td>R1C3</td></tr>
<tr><td>R2C2</td><td>R2C3</td></tr>
<tr><td colspan="2">Spans two columns</td><td>R3C3</td></tr>
</tbody>
</table>

## Formatting inside HTML cells

These cells use HTML tags for bold text, italic text, and line breaks.

<table><thead><tr><th>Format</th><th>Content</th></tr></thead><tbody><tr><td><strong>Bold text</strong></td><td>First line<br>Second line</td></tr><tr><td><em>Italic text</em></td><td>Regular text</td></tr><tr><td><code>inline code</code></td><td>Regular text</td></tr></tbody></table>

## Closing paragraph

This regular paragraph follows a table to show spacing between the table and body text, and caret positioning when entering or leaving the table.
