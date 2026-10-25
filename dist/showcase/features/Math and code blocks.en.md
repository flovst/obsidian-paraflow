# Math and code blocks

[Showcase index](../README.md) · [中文](Math%20and%20code%20blocks.zh.md)

This note covers the display and editing of inline math, display math, and code blocks, including code wrapping, line numbers, and copying.

## Inline math

Simple formula: $x^2 + y^2 = z^2$.

Fractions and sums: $\frac{1}{n}\sum_{i=1}^{n}x_i$, and $\frac{a+b}{c+d}$.

This is regular text before a formula, $e^{i\pi}+1=0$, followed by more regular text to show the baseline, spacing, and wrapping of text alongside math.

## Display math

Click a formula to edit its source, then move focus away to see the rendered result.

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

## Multiline formulas and matrices

These formulas include alignment, multiple lines, and matrix brackets.

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

## Code fences and syntax highlighting

Inline code: `const lineHeight = 1.6;`.

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

## Long lines and empty lines

The code below includes a long line and an empty line for checking wrapping, line numbers, and copying. Toggle wrapping and line numbers individually in settings.

```js
const sampleText = "Long line sample: segment 01, segment 02, segment 03, segment 04, segment 05, segment 06, segment 07, segment 08, segment 09, segment 10.";

const segments = sampleText.split(", ");
console.log({ sampleText, count: segments.length });
```

After copying the code, inspect its indentation, empty lines, and text in Source view. Display line numbers appear only in the editor.

## Plain text and indentation

```text
Level 0
    Level 1
        Level 2

    Level 1 after an empty line
Level 0
```

## Closing paragraph

This regular paragraph follows a code block to show the spacing between code and body text. Switch between Follow Obsidian and ParaFlow Classic to compare math and code styling.
