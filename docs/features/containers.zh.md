# 引用、Callout 与 HTML 块

[文档索引](../README.zh.md) · [English](containers.en.md)

ParaFlow 管理引用与 Callout 的结构标记，提供 Callout 标题、图标和折叠显示，并支持容器内的段落与列表编辑。

## 使用

在实时预览中编辑以 `>` 开头的引用，或以 `> [!note]` 等标记开头的 Callout。编辑、拆分容器内列表时，ParaFlow 保留对应的 `>` 前缀。

容器内可以包含多个段落、嵌套列表和任务列表。列表操作见[列表与任务](lists.zh.md)，段落显示见[段落与换行](paragraphs.zh.md)。对于可折叠的 Callout，可以通过折叠控件展开和收起正文。

HTML 预览支持 `<div>`、`<details>` 等 HTML 块的源码编辑与预览。HTML 表格使用独立的[表格功能](tables.zh.md)。

## 设置

在 **设置 → ParaFlow → 编辑** 中分别开关 **引用 & Callout** 与 **HTML 预览**。容器中的文字样式由当前[内容主题](themes.zh.md)控制。

需要检查结构时，切换到源码视图查看引用前缀、Callout 类型和 HTML 标签。编辑 HTML 内容时使用对应的 HTML 标记。

## 示例

- [列表、引用与 Callout 展示](../../showcase/features/Lists%20quotes%20and%20callouts.zh.md)：引用中的段落和列表、普通与折叠 Callout。
- [Markdown 语法展示](../../showcase/Markdown%20syntax%20showcase.zh.md)：与正文、其它 Markdown 内容的组合。
