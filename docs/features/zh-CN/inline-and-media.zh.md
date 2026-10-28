# 行内格式、链接、图片与脚注

[文档索引](../../README.zh.md) · [English](../EN/inline-and-media.en.md)

ParaFlow 在 Live Preview 中提供行内格式的源码隐藏/显示，以及链接、图片和脚注的编辑等。



## 使用

<video src="../assets/videos/inline/inlinecode.mp4" controls=""></video>

主要是将显示的源码符号（比如`*`、`~` 等）改为灰色，修复部分情况下删除线的显示，以及增加对上下标的支持。

<video src="../assets/videos/inline/edit-image.mp4" controls=""></video>

对于图片，则是添加了 “单击显示图片源码” 的功能，并默认设置了居中。

![image-20261028032813125](../assets/images/image-20261028032813125.png)

脚注部分主要添加了来回跳转的链接并调整了格式。



## 设置

在 **设置 → ParaFlow → 编辑** 中分别调整：

| 分组 | 主要设置 |
| --- | --- |
| 行内格式 & 链接 | 单击链接时的操作、上下标、Obsidian 注释显示 |
| 图片 | 进入编辑位置时显示源码、图片居中 |
| 脚注 | 脚注显示与导航增强 |

Obsidian 注释可以始终显示，或仅在编辑时显示。需要核对链接目标、图片路径和脚注标记时，可切换到源码视图。

## 示例

[Markdown 语法展示](../../../dist/showcase/Markdown%20syntax%20showcase.zh.md) 提供行内格式、链接、图片和脚注示例。示例图片使用随展示文件提供的资源，复制笔记时应一并保留资源及相对路径。
