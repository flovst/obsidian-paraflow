# 段落、换行与标题

[文档索引](../../README.zh.md) · [English](../EN/paragraphs.en.md)

ParaFlow 在 Live Preview 中将段落间的单个空行显示为（不可编辑的）段间距，多个连续的空行会被保留为可以编辑的 “空段落”

>  Typora 中最好用的功能之一，也是这个插件的起点（Paragraph-Flow）

此外，段落排版还可以调整首行缩进、段间距和制表符的显示。

## 使用

#### 段落 & 换行

<video src="../assets/videos/paragraph/paragraph.mp4" controls=""></video>

默认的操作是：

+ Enter：添加两个换行
+ Shift + Enter：添加一个换行

此外，段落之间的单个空行会被渲染成 “段落间距” 且不可编辑；通常两个连续的空行才会被渲染成一个 “可编辑的空行”。

#### 标题

<video src="../assets/videos/paragraph/heading.mp4" controls=""></video>

与 Typora 中一致，在创建好标题后，其样式在后续编辑中会保持稳定；如果需要修改 heading 层级，可以使用类似 Ctrl + num 的快捷键，或者切换到 Source Mode 中修改。

## 设置

在 **设置 → ParaFlow → 编辑** 中调整：

| 设置 | 用途 |
| --- | --- |
| 段落 & 换行 | 启用段落间距与换行编辑 |
| HTML 换行标记 | 显示 `<br>` 等标签的换行提示 |
| 首行缩进 | 调整正文段落首行的显示 |
| 段间距 | 调整段落之间的距离 |
| Tab 显示方式、Tab 宽度 | 选择固定宽度或按制表位对齐，并调整宽度 |
| 标题 | 启用标题标记与编辑行为 |

首行缩进、段间距和 Tab 显示调整只影响排版，保留源码中的字符。正文 Tab 宽度使用当前内容字体的空格宽度；源码视图有独立的 Tab 设置。

## 示例

打开 [Markdown 语法展示](../../../dist/showcase/Markdown%20syntax%20showcase.zh.md)，比较正文、标题、空行与换行的显示。列表中的续行和段落见[列表与任务](lists.zh.md)。
