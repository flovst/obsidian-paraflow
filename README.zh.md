# ParaFlow

[English](README.md) | 中文

ParaFlow 是一个尝试将 Typora 中的部分功能/体验迁移到 Obsidian 中的插件，比如段落控制、list 编辑、公式编辑等。

> 我太喜欢 Typora 那种无干扰的体验了，但 Obsidian 的 wiki link 也很香，所以我想实现一个”内置 typora 的 obsidian“。
>

## 主要功能

##### 段落

<video src="docs/features/assets/videos/paragraph/paragraph.mp4" controls=""></video>

https://github.com/user-attachments/assets/fa9055ab-8fc5-4547-abe0-1da0e7e2e28e

将段落之间的空行渲染成较宽的段间距（这个功能也是 ParaFlow 名字的由来）

##### 列表

<video src="docs/features/assets/videos/table/table-short.mp4" controls=""></video>

https://github.com/user-attachments/assets/aef5b5fc-9c2a-44df-8e3e-acef785b407b

像富文本编辑器那样调整列表/任务的缩进。

##### 表格

<video src="docs/features/assets/videos/table/edit-table.mp4" controls=""></video>

https://github.com/user-attachments/assets/44d94da5-6032-467e-87d7-92210ccba373

除了表格上方的控件，还增加了对 HTML 表格的支持。

##### 引用和 Callout

<video src="docs/features/assets/videos/quotes-and-callouts/create-quote.mp4" controls=""></video>

https://github.com/user-attachments/assets/b5103216-713b-4e5e-9f35-a3e61619a3d8

让 ParaFlow 来管理 ">" 和换行符的插入

##### 公式

<video src="docs/features/assets/videos/math/edit-math.mp4" controls=""></video>

https://github.com/user-attachments/assets/1c39197c-d40d-4bac-ad59-6111b55baa35

提供行内公式的预览与数学公式块的样式

##### 代码块

<video src="docs/features/assets/videos/codeblock/create.mp4" controls=""></video>

https://github.com/user-attachments/assets/6a585651-0a82-421d-8e2b-fc940c904221

显示行号、边界 fence 和语言的辅助输入等。

##### 阅读/源码视图

<video src="docs/features/assets/videos/views/change-view.mp4" controls=""></video>

https://github.com/user-attachments/assets/6ba2c5a7-daff-4623-bcb0-692d9bbbee16

优化各个视图的显示效果（尤其是源码模式）与复制粘贴。

其它：

+ 标题、行内格式、脚注、图片等显示优化
+ 支持导入 Typora 的主题，兼容 Obsidian 的主题（大概）
+ 每个功能都可以在设置中单独开关（至少在预期中是），但目前可能仍然存在问题

Release 中提供了已安装 ParaFlow 的 [showcase](../../releases/tag/0.1.5) 库，可以直接试试。

## 安装

#### 体验 showcase 库

从 [Release](../../releases/tag/0.1.5) 下载 `showcase-paraflow-0.1.5.zip`，解压后在 Obsidian 中将 `showcase-paraflow` 文件夹作为笔记库打开，其中包含对应版本的 ParaFlow、示例笔记和预设配置。

#### 手动安装

直接从最新 release 下载 `main.js` 、 `manifest.json`、`styles.css` 三个文件放入 Obsidian Vault 的 `.obsidian/plugins/paraflow/` 目录，然后在 Obsidian 的社区插件设置中启用 ParaFlow。

<details>
<summary>从源码构建</summary>

将代码拉取到本地，然后运行以下指令（需要 Node.js 20 或以上与 npm）

```
npm ci
npm run build
```

将根目录生成的 `main.js`、`manifest.json`、`styles.css` 复制到笔记库的插件目录。

</details>

## 其它

#### 已知问题

+ 目前主要在 Windows 上进行开发，MacOS / Linux 以及移动端暂时不保证支持（
+ 目前在较长的文档中可能存在性能问题

## 开发与贡献

如果有任何问题，欢迎提交 issue 或 PR，记得说明 Obsidian 版本、操作步骤、预期与实际结果，并尽量提供最小 Markdown 示例。

```sh
npm run dev    # 开发构建与文件监听
npm run build  # 类型检查与生产构建
npm run lint   # 代码静态检查
```
