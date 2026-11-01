# ParaFlow

English | [中文](README.zh.md)

ParaFlow is an Obsidian plugin that brings some of Typora's features and editing experience to Obsidian, including paragraph handling, list editing, and math editing.

> I love Typora's distraction-free experience and Obsidian's wiki links, so I wanted to build an "Obsidian with Typora inside."

## Main features

##### Paragraphs

<video src="docs/features/assets/videos/paragraph/paragraph.mp4" controls=""></video>

https://github.com/user-attachments/assets/fa9055ab-8fc5-4547-abe0-1da0e7e2e28e

Render blank lines between paragraphs as larger gaps. This feature gave ParaFlow its name.

##### Lists

<video src="docs/features/assets/videos/table/table-short.mp4" controls=""></video>

https://github.com/user-attachments/assets/aef5b5fc-9c2a-44df-8e3e-acef785b407b

Adjust list and task indentation as in a rich-text editor.

##### Tables

<video src="docs/features/assets/videos/table/edit-table.mp4" controls=""></video>

https://github.com/user-attachments/assets/44d94da5-6032-467e-87d7-92210ccba373

Add controls above tables and support for HTML tables.

##### Quotes and Callouts

<video src="docs/features/assets/videos/quotes-and-callouts/create-quote.mp4" controls=""></video>

https://github.com/user-attachments/assets/b5103216-713b-4e5e-9f35-a3e61619a3d8

Let ParaFlow handle inserting `>` prefixes and line breaks.

##### Math

<video src="docs/features/assets/videos/math/edit-math.mp4" controls=""></video>

https://github.com/user-attachments/assets/1c39197c-d40d-4bac-ad59-6111b55baa35

Preview inline math and style display math blocks.

##### Code blocks

<video src="docs/features/assets/videos/codeblock/create.mp4" controls=""></video>

https://github.com/user-attachments/assets/6a585651-0a82-421d-8e2b-fc940c904221

Show line numbers and assist with code fences and language input.

##### Reading and Source views

<video src="docs/features/assets/videos/views/change-view.mp4" controls=""></video>

https://github.com/user-attachments/assets/6ba2c5a7-daff-4623-bcb0-692d9bbbee16

Improve rendering in each view, especially Source mode, along with copying and pasting.

Other features:

- Improve the display of headings, inline formatting, footnotes, images, and more.
- Import Typora themes and work with Obsidian themes, with compatibility still being refined.
- Toggle each feature individually in settings. Some issues may remain.

A [showcase vault](../../releases/tag/0.1.5) with ParaFlow installed is available in the release for a quick trial.

## Installation

#### Try the showcase vault

Download `showcase-paraflow-0.1.5.zip` from the [release](../../releases/tag/0.1.5), extract it, and open the `showcase-paraflow` folder as a vault in Obsidian. It includes the matching ParaFlow build, example notes, and preset settings.

#### Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the latest release, place them in your Obsidian vault's `.obsidian/plugins/paraflow/` directory, and enable ParaFlow in Obsidian's Community plugins settings.

<details>
<summary>Build from source</summary>

Clone the repository and run the following commands (requires Node.js 20 or later and npm):

```sh
npm ci
npm run build
```

Copy the generated `main.js`, `manifest.json`, and `styles.css` from the project root into the plugin directory in your Obsidian vault.

</details>

## Misc

#### Known issues

- Development is primarily on Windows. Support for macOS, Linux, and mobile is still unverified.
- Performance issues may occur with longer documents.

## Development and contributions

If you encounter any issues, feel free to open an issue or submit a PR. Please include your Obsidian version, steps to reproduce, expected and actual results, and a minimal Markdown example where possible.

```sh
npm run dev    # Development build and file watching
npm run build  # Type checking and production build
npm run lint   # Static code checks
```
