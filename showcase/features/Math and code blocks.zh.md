# 公式与代码块

[展示索引](../README.md) · [English](Math%20and%20code%20blocks.en.md)

这份笔记用于检查行内公式、块公式和代码块的显示与编辑，以及代码换行、行号和复制效果。

## 行内公式

简单公式：$x^2 + y^2 = z^2$。

分式与求和：$\frac{1}{n}\sum_{i=1}^{n}x_i$，以及 $\frac{a+b}{c+d}$。

这是公式前的普通文本，$e^{i\pi}+1=0$，这是公式后的普通文本，用于观察文字与公式的基线、间距和自动换行。

## 块公式

点击公式可以编辑源码，移开焦点后查看渲染结果。

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

## 多行公式与矩阵

下面的公式包含对齐、多行结构和矩阵括号。

$$
\begin{aligned}
f(x) &= x^2 + 2x + 1 \\
     &= (x+1)^2 \\
f'(x) &= 2x + 2
\end{aligned}
$$

$$
\mathbf{A} = \begin{pmatrix}
1 & 2 & 3 \\
4 & 5 & 6
\end{pmatrix}
$$

## 代码围栏与语法高亮

行内代码：`const lineHeight = 1.6;`。

```ts
interface DisplayOptions {
    lineHeight: number;
    showLineNumbers: boolean;
    wrapCode: boolean;
}

const options: DisplayOptions = {
    lineHeight: 1.6,
    showLineNumbers: true,
    wrapCode: false,
};

console.log(options);
```

## 长行与空行

下面的代码包含长行和空行，用于检查自动换行、行号和代码复制。可以在设置中分别切换换行与行号。

```js
const sampleText = "Long line sample: segment 01, segment 02, segment 03, segment 04, segment 05, segment 06, segment 07, segment 08, segment 09, segment 10.";

const segments = sampleText.split(", ");
console.log({ sampleText, count: segments.length });
```

复制代码后，可在源码视图中检查缩进、空行和文本内容。显示行号仅出现在编辑器中。

## 纯文本与缩进

```text
Level 0
    Level 1
        Level 2

    Level 1 after an empty line
Level 0
```

## 结束段落

这是代码块后的普通段落，用于观察代码块与正文之间的间距。切换 Follow Obsidian 和 ParaFlow Classic 可以比较公式与代码块的主题样式。
