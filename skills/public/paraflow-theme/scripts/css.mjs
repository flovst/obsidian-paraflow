import * as csstree from 'css-tree';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function parseCss(css, filename = '<css>') {
  try {
    validateDelimiters(css);
    return csstree.parse(css, { positions: true, filename, parseCustomProperty: true,
      onParseError(error) { throw error; } });
  } catch (error) {
    throw new Error(`${filename}: invalid CSS: ${error.message}`);
  }
}

// css-tree recovers omitted closing tokens; a source adapter requires complete input.
export function validateDelimiters(source) {
  const types = csstree.tokenTypes;
  const openings = new Map([[types.LeftCurlyBracket, types.RightCurlyBracket],
    [types.LeftSquareBracket, types.RightSquareBracket], [types.LeftParenthesis, types.RightParenthesis],
    [types.Function, types.RightParenthesis]]);
  const closing = new Set([types.RightCurlyBracket, types.RightSquareBracket, types.RightParenthesis]);
  const stack = [];
  csstree.tokenize(source, (type, start, end) => {
    if (openings.has(type)) stack.push(openings.get(type));
    else if (closing.has(type) && stack.pop() !== type) throw new Error('Mismatched CSS delimiter');
    else if (type === types.BadString || type === types.BadUrl) throw new Error('Invalid CSS string or URL');
    else if (type === types.Comment && !source.slice(start, end).endsWith('*/')) throw new Error('Unclosed CSS comment');
    else if (type === types.String && source[end - 1] !== source[start]) throw new Error('Unclosed CSS string');
  });
  if (stack.length) throw new Error('Unclosed CSS delimiter');
}

export function isMain(url) {
  return Boolean(process.argv[1]) && url === pathToFileURL(resolve(process.argv[1])).href;
}

export function inspectCss(inputs) {
  const result = { selectors: [], variables: [], imports: [], urls: [] };
  for (const { css, filename = '<css>' } of inputs) {
    const ast = parseCss(css, filename);
    csstree.walk(ast, node => {
      if (!['Selector', 'Declaration', 'Url', 'Atrule'].includes(node.type)) return;
      const position = { filename, line: node.loc.start.line, column: node.loc.start.column };
      if (node.type === 'Selector') result.selectors.push({ value: csstree.generate(node), ...position });
      if (node.type === 'Declaration' && node.property.startsWith('--')) {
        result.variables.push({ name: node.property, value: csstree.generate(node.value), ...position });
      }
      if (node.type === 'Url') result.urls.push({ value: node.value, ...position });
      if (node.type === 'Atrule' && node.name.toLowerCase() === 'import') {
        result.imports.push({ value: csstree.generate(node.prelude), ...position });
      }
    });
  }
  return result;
}

export { csstree };
