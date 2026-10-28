# 视图与复制粘贴

[文档索引](../../README.zh.md) · [English](../EN/views-and-clipboard.en.md)

ParaFlow 对 Obsidian 中的三个视图都进行了对应的优化：

+ Live Preview：主要的优化部分，具体效果见其它对应语法的参考文件
+ Reading View：除了不显示 Obsidian 注释、省略空行等少数行为以外，其它的尽量与 Live Preview 保持一致
+ Source Mode：提供了行号、当前行高亮、源码语法高亮、空白字符显示等编辑辅助。如果有 Live Preview 中不能编辑的部分，都可以在 Source View 中进行修改



## 切换与检查

<video src="../assets/videos/views/change-view.mp4" controls=""></video>

视频中是用快捷键在 3 种 view 种切换了一下：

+ Ctrl + E： Live Preview ↔ Reading View
+ Ctrl+ /： Live Preview ↔ Source Mode

可以看到 Reading View 与 Live Preview 基本没什么区别；Source Mode 就基本是参考 Typora 的风格并调整了一下主题色。



## 复制与粘贴

在默认情况下，Live Preview 中的复制/粘贴会自动不全 code block、math 等的边界（智能粘贴），而 Source Mode 中则会完全按照原本的字符进行复制/粘贴（精确文本）。
具体配置可以在设置的  **编辑 → 复制 & 粘贴** 中进行调整。

| 方式 | 行为 |
| --- | --- |
| 精确文本 | 保留剪贴板可提供的原始文本表示 |
| 智能粘贴 | 使用 Obsidian 的富文本转换与附件处理 |

## 相关设置与示例

**鼠标 & 选区** 提供禁止拖动选区文字、选区时隐藏光标。切换模式时的源码整理见[列表与任务](lists.zh.md)。

使用 [Markdown 语法展示](../../../dist/showcase/Markdown%20syntax%20showcase.zh.md) 对比三个视图，并尝试复制带格式的文本、列表和代码。
