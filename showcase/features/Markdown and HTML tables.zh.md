# Markdown 与 HTML 表格

[展示索引](../README.md) · [English](Markdown%20and%20HTML%20tables.en.md)

这份笔记用于检查 Markdown 与 HTML 表格的单元格编辑、行列操作、对齐和跨行跨列结构。

## Markdown 表格

下面的三列分别使用左对齐、居中和右对齐。可以编辑单元格，或通过表格控件添加、删除行列。

| 左对齐 | 居中 | 右对齐 |
| :--- | :---: | ---: |
| 第一行文本 | A | 100 |
| 第二行文本 | B | 200 |
| 第三行文本 | C | 300 |

## 长文本与行内格式

| 格式 | 内容 |
| :--- | :--- |
| **粗体文本** | 这是单元格中的长文本，用于观察列宽变化时的自动换行、行高和单元格内边距。缩小编辑器宽度后，这段文字会占据更多显示行。 |
| *斜体文本* | 这是第二行的普通文本。 |
| `inline code` | 这是第三行的普通文本。 |
| ~~删除线~~ | 这是第四行的普通文本。 |

## HTML 表格与垂直对齐

第一行包含多行单元格，以及顶部、居中和底部对齐的短文本。

<table>
<thead>
<tr><th>多行内容</th><th>顶部对齐</th><th>居中对齐</th><th>底部对齐</th></tr>
</thead>
<tbody>
<tr><td>第一行<br>第二行<br>第三行</td><td style="vertical-align: top;">顶部</td><td style="vertical-align: middle;">居中</td><td style="vertical-align: bottom;">底部</td></tr>
<tr><td>普通单元格</td><td>A</td><td>B</td><td>C</td></tr>
</tbody>
</table>

对 Markdown 表格设置垂直对齐时，可在源码视图中查看转换后的 HTML，并用 Undo 检查还原结果。

## 跨行与跨列

下面的表格包含一个跨两行的单元格，以及一个跨两列的单元格。

<table>
<thead>
<tr><th>第一列</th><th>第二列</th><th>第三列</th></tr>
</thead>
<tbody>
<tr><td rowspan="2">跨两行</td><td>R1C2</td><td>R1C3</td></tr>
<tr><td>R2C2</td><td>R2C3</td></tr>
<tr><td colspan="2">跨两列</td><td>R3C3</td></tr>
</tbody>
</table>

## HTML 单元格中的格式

下面的单元格使用 HTML 标签表示粗体、斜体和换行。

<table>
<thead>
<tr><th>格式</th><th>内容</th></tr>
</thead>
<tbody>
<tr><td><strong>粗体文本</strong></td><td>第一行<br>第二行</td></tr>
<tr><td><em>斜体文本</em></td><td>普通文本</td></tr>
<tr><td><code>inline code</code></td><td>普通文本</td></tr>
</tbody>
</table>

## 结束段落

这是表格后的普通段落，用于检查表格与正文的间距，以及光标进出表格时的位置。
