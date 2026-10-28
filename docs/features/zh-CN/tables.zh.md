# Markdown 与 HTML 表格

[文档索引](../../README.zh.md) · [English](../EN/tables.en.md)

ParaFlow 提供类似 Typora 中的表格样式与悬浮窗，此外还添加了对 HTML 表格的支持（包括单元格合并等操作）单元格编辑、行列操作、对齐与合并功能。显示增强包括自动布局、条纹和溢出处理。

## 使用

<video src="../assets/videos/table/edit-table.mp4" controls=""></video>

对于 Markdown 表格，主要是做了视觉优化与顶部的快捷浮窗：

+ 视觉优化：条纹样式、自动布局、宽度自动调整等
+ 快捷键：
  + Alt + 方向键：移动行/列
  + Ctrl + Enter：新增一行
  + Ctrl + Shift + Backspace：删除当前行
+ 表格顶部添加了 Typora 风格的快捷浮窗，提供：
  + 行/列数量调整
  + 水平/垂直对齐调整
  + Markdown 与 HTML 指示与转换
  + 删除与更多菜单

#### HTML 表格

ParaFlow 支持 HTML 表格的编辑等，尽可能让其编辑体验与 Markdown 表格一致。

<video src="../assets/videos/table/merge-cell.mp4" controls=""></video>

对于 HTML，ParaFlow 主要支持了：

+ 垂直对齐
+ 单元格合并 / 拆分（主要参考 excel 中的行为）
+ 对 Markdown 表格应用垂直对齐等需要 HTML 表达的格式时，ParaFlow 会将支持的表格转换为标准 HTML
+ 提供 HTML 表格源码格式化

## 设置

在 **设置 → ParaFlow → 编辑 → 表格** 中调整：

| 设置 | 用途 |
| --- | --- |
| 显示增强 | 自动布局、条纹与溢出处理 |
| 编辑增强 | 单元格操作、合并、格式与 HTML 转换 |
| 表格内自动换行 | 在折行显示与宽表格横向滚动之间切换 |
| 单元格合并提示 | 恢复合并时丢弃其它单元格内容的提示 |

显示增强和编辑增强可以分别启用。表格颜色、边框和字体由[内容主题](themes.zh.md)提供。

## 示例

[Markdown 与 HTML 表格展示](../../../dist/showcase/features/Markdown%20and%20HTML%20tables.zh.md) 包含水平和垂直对齐、长文本、跨行跨列及 HTML 单元格格式。
