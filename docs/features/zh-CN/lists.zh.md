# 列表与任务

[文档索引](../../README.zh.md) · [English](../EN/lists.en.md)

ParaFlow 为各种列表（无序、有序列表和 Task）提供条目创建、拆分、缩进与层级调整，在编辑内容时避免对 list 的样式/缩进等造成影响。

>  同样是 Typora 中最好用的功能之一（

## 使用

在 Live Preview 中编辑列表：

<video src="../assets/videos/list/edit-list.mp4" controls=""></video>

由 ParaFlow 来管理 list marker 的样式与缩进，避免直接编辑 list 结构的源码；如果有必要，可以切换到 Source Mode 进行编辑。

具体的按键操作与 Typora 中基本保持一致：

+ Enter：新建同级 list 项；如果当前 list 项内容为空时，则去掉 list marker / 调整缩进
+ Shift + Enter：新建同一个 list 项的新段落
+ Tab / Shift+Tab：调整 list 缩进

Task 列表则按照 Obsidian 中的快捷键，可以使用 Ctrl + Enter 来创建。

## 设置

在 **设置 → ParaFlow → 编辑 → 列表 & 任务** 中开关列表编辑。无序列表符号可以按嵌套层级显示，也可以使用固定形状；这一设置调整显示样式。

**编辑 → 其它 → 源码自动整理** 提供四种选项：从不、手动保存时、切换视图时、手动保存或切换视图时。

- 手动保存：在主编辑器中按 `Ctrl+S`，补足列表续行的结构缩进，并根据编辑期间建立的归属补充缺失的零宽分隔符。自动保存和菜单保存不触发这次全文检查。
- 切换视图：同一文件在实时预览、源码和阅读模式之间切换，且编辑器可用时，补足结构缩进。此操作只整理缩进。
- 整理产生的修改可以撤销；没有修改时不会增加撤销记录。

（这一条主要是用来自动整理 list 源码中 marker 前面的空格数量等）

## 源码中的分隔符

结构化编辑可能在 Markdown 中插入不可见的 U+200B 字符（ZWSP，零宽空格），用来区分 “缩进空格” 与 ”普通正文空格“（这种写法在 Typora 中也是受支持的）。Live Preview 会隐藏并保护受管理的前缀，Source Mode 中则可以看到这些字符。

## 示例

[列表、引用与 Callout 展示](../../../dist/showcase/features/Lists%20quotes%20and%20callouts.zh.md) 包含无序、有序、任务、嵌套列表，以及条目中的续行和额外段落。
