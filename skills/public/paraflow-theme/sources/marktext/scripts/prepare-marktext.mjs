import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { csstree, isMain, parseCss } from '../../../scripts/css.mjs';

const mappings = [
  ['body', 'color', 'editorColor', 'editor-color', true],
  ['html, body', 'background-color', 'editorBgColor', 'editor-bg-color', true],
  ...Array.from({ length: 6 }, (_, i) => [`h${i + 1}`, 'color', `h${i + 1}Color`, `h${i + 1}-color`]),
  ['a', 'color', 'linkColor', 'link-color'],
  ['blockquote', 'color', 'blockquoteTextColor', 'blockquote-text-color'],
  ['blockquote', 'border-color', 'blockquoteBorderColor', 'blockquote-border-color'],
  ['hr', 'border-color', 'hrColor', 'hr-color'],
  ['code', 'background-color', 'codeBgColor', 'code-bg-color'],
  ['pre', 'background-color', 'codeBlockBgColor', 'code-block-bg-color'],
  ['pre', 'color', 'codeBlockColor', 'code-block-color'],
  ['table, th, td', 'border-color', 'tableBorderColor', 'table-border-color'],
  ['strong', 'color', 'strongColor', 'strong-color'],
  ['em', 'color', 'emColor', 'em-color'],
  ['::selection', 'background-color', 'selectionColor', 'selection-color'],
  ['li::marker', 'color', 'listMarkerColor', 'list-marker-color'],
];

function extractVariables(inputs) {
  const variables = new Map();
  const ignored = [];
  inputs.forEach(({ css, filename = '<css>' }, layer) => {
    const ast = parseCss(css, filename);
    ast.children.forEach(node => {
      if (node.type === 'Comment') return;
      if (node.type !== 'Rule' || node.prelude?.type !== 'SelectorList' ||
          !node.prelude.children.some(selector => csstree.generate(selector) === ':root')) {
        ignored.push({ filename, kind: node.type, selector: node.prelude ? csstree.generate(node.prelude) : '',
          reason: node.type === 'Atrule' ? 'at-rule/import/conditional context is not evaluated' : 'not an unconditional :root rule' });
        return;
      }
      node.block.children.forEach(declaration => {
        if (declaration.type !== 'Declaration' || !declaration.property.startsWith('--')) return;
        const previous = variables.get(declaration.property);
        if (previous?.important && !declaration.important) return;
        variables.set(declaration.property, { value: csstree.generate(declaration.value),
          filename, layer, important: Boolean(declaration.important) });
      });
    });
  });
  return { variables, ignored };
}

function variableResolver(variables) {
  const dependencies = new Map();
  for (const [name, { value }] of variables) {
    const refs = [];
    csstree.walk(csstree.parse(value, { context: 'value' }), node => {
      if (node.type === 'Function' && node.name.toLowerCase() === 'var') {
        const first = node.children.first;
        if (first?.type === 'Identifier') refs.push(first.name);
      }
    });
    dependencies.set(name, refs);
  }
  const cyclic = new Set();
  const visited = new Set();
  function visit(name, path) {
    if (path.includes(name)) { path.slice(path.indexOf(name)).forEach(item => cyclic.add(item)); return; }
    if (visited.has(name)) return;
    for (const next of dependencies.get(name) ?? []) visit(next, [...path, name]);
    visited.add(name);
  }
  for (const name of variables.keys()) visit(name, []);
  const cache = new Map();
  function resolveValue(value) {
    const ast = csstree.parse(value, { context: 'value' });
    function render(node) {
      if (node.type === 'Function' && node.name.toLowerCase() === 'var') {
        const children = node.children.toArray();
        const comma = children.findIndex(child => child.type === 'Operator' && child.value === ',');
        const name = children[0]?.name;
        if (children[0]?.type !== 'Identifier' || !name.startsWith('--') || (comma < 0 && children.length !== 1)) {
          throw new Error('invalid var() expression');
        }
        try { return resolveVariable(name); }
        catch (error) {
          if (comma < 0) throw error;
          const fallback = children.slice(comma + 1).map(child => csstree.generate(child)).join(' ');
          return resolveValue(fallback);
        }
      }
      if (node.type === 'Function') return `${node.name}(${node.children.toArray().map(render).join(' ')})`;
      if (node.type === 'Parentheses') return `(${node.children.toArray().map(render).join(' ')})`;
      return csstree.generate(node);
    }
    return ast.children.toArray().map(render).join(' ');
  }
  function resolveVariable(name) {
    if (cyclic.has(name)) throw new Error(`cyclic variable ${name}`);
    if (!variables.has(name)) throw new Error(`missing variable ${name}`);
    // CSS-wide keywords default the declaration before substitution. Only raw
    // root values qualify; a keyword produced inside var() is a literal token.
    const raw = variables.get(name).value.trim();
    if (/^(?:initial|inherit|unset)$/i.test(raw)) {
      throw new Error(`root custom property ${name}: ${raw} has the guaranteed-invalid initial value`);
    }
    if (/^(?:revert|revert-layer)$/i.test(raw)) {
      throw new Error(`root custom property ${name}: ${raw} needs an unavailable lower origin/layer`);
    }
    if (!cache.has(name)) cache.set(name, resolveValue(variables.get(name).value));
    return cache.get(name);
  }
  return { resolveVariable, dependencies, cyclic: [...cyclic] };
}

export function prepareMarktext(inputs) {
  const { variables, ignored } = extractVariables(inputs);
  const { resolveVariable, dependencies, cyclic } = variableResolver(variables);
  const report = {
    kind: 'marktext-content-palette', inputFiles: inputs.map(input => input.filename ?? '<css>'),
    mapped: [], missing: [], conflicts: [], unresolved: [], cycles: cyclic,
    ignoredRules: ignored, ignoredVariables: [], dependencyVariables: [],
    limitations: ['Only unconditional :root color tokens are adapted.',
      'MarkText highlightColor/highlight-color describe search matches, not HTML mark or Markdown highlight; these tokens are not mapped to mark.',
      'Raw root initial/inherit/unset tokens are invalid; revert/revert-layer require unavailable lower origins/layers. Their var() fallbacks are used and the tokens are reported unresolved.',
      'Typography, spacing, application UI, resources and syntax highlighting need separate source review.',
      'Source version and license must be recorded by the caller.'],
  };
  for (const name of variables.keys()) {
    try { resolveVariable(name); }
    catch (error) { report.unresolved.push({ variable: name, reason: error.message }); }
  }
  const used = new Set();
  const rules = [];
  const requiredErrors = [];
  for (const [selector, property, legacy, modern, required = false] of mappings) {
    const candidates = [`--${legacy}`, `--${modern}`].filter(name => variables.has(name));
    candidates.sort((a, b) => Number(variables.get(b).important) - Number(variables.get(a).important) ||
      variables.get(b).layer - variables.get(a).layer || Number(b === `--${modern}`) - Number(a === `--${modern}`));
    const variable = candidates[0];
    candidates.forEach(name => used.add(name));
    let reason;
    if (!variable) reason = 'token absent';
    else {
      try {
        const value = resolveVariable(variable);
        if (!csstree.lexer.matchProperty(property, value).matched ||
            (required && /^(?:inherit|initial|unset|revert|revert-layer|currentcolor|transparent)$/i.test(value))) {
          throw new Error(`invalid explicit ${property}: ${value}`);
        }
        if (candidates.length === 2) {
          let other;
          try { other = resolveVariable(candidates[1]); } catch { /* Reported as unresolved above. */ }
          if (other !== undefined && other !== value) report.conflicts.push({ variable, value, otherVariable: candidates[1], otherValue: other });
        }
        rules.push(`${selector} { ${property}: ${value}; }`);
        report.mapped.push({ selector, property, variable, value, filename: variables.get(variable).filename });
        continue;
      } catch (error) { reason = error.message; }
    }
    report.missing.push({ selector, property, candidates: [`--${legacy}`, `--${modern}`], required, reason });
    if (required) requiredErrors.push(`${property}: ${reason}`);
  }
  const needed = new Set(used);
  function collectDependencies(name) {
    for (const dependency of dependencies.get(name) ?? []) {
      if (needed.has(dependency)) continue;
      needed.add(dependency);
      collectDependencies(dependency);
    }
  }
  for (const name of used) collectDependencies(name);
  report.dependencyVariables = [...variables.keys()].filter(name => needed.has(name) && !used.has(name));
  report.ignoredVariables = [...variables.keys()].filter(name => !needed.has(name));
  if (requiredErrors.length) {
    const error = new Error(`Cannot prepare MarkText palette: ${requiredErrors.join('; ')}`);
    error.report = report;
    throw error;
  }
  return { css: `/* MarkText content palette adapter. Review typography and syntax highlighting separately. */\n${rules.join('\n')}\n`, report };
}

export function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--base', '--theme', '--output', '--report'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || options[key]) {
      throw new Error('Usage: node prepare-marktext.mjs --base index.css --theme theme.css --output NEW.css [--report NEW.json]');
    }
    options[key] = resolve(args[i + 1]);
  }
  if (!options['--base'] || !options['--theme'] || !options['--output']) throw new Error('--base, --theme and --output are required');
  const targets = [options['--output'], options['--report']].filter(Boolean);
  if (new Set(targets).size !== targets.length || targets.some(target => existsSync(target))) throw new Error('Output/report must be distinct new files');
  const result = prepareMarktext(['--base', '--theme'].map(key => ({ filename: options[key], css: readFileSync(options[key], 'utf8') })));
  // Reserve all targets before writing; an existing file is never replaced.
  const opened = [];
  try {
    for (const target of targets) opened.push([target, openSync(target, 'wx')]);
    writeFileSync(opened[0][1], result.css);
    if (opened[1]) writeFileSync(opened[1][1], `${JSON.stringify(result.report, null, 2)}\n`);
  } catch (error) {
    for (const [target, fd] of opened) { closeSync(fd); unlinkSync(target); }
    throw error;
  }
  for (const [, fd] of opened) closeSync(fd);
  process.stdout.write(`${JSON.stringify({ output: options['--output'], report: options['--report'] ?? null,
    mapped: result.report.mapped.length, missing: result.report.missing.length })}\n`);
  return result;
}

if (isMain(import.meta.url)) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    if (error.report) process.stderr.write(`${JSON.stringify(error.report, null, 2)}\n`);
    process.exitCode = 1;
  }
}
