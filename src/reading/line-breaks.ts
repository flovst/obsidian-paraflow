import { GFM, parser } from '@lezer/markdown';
import { metadataGrammar, nativeInlineGrammarFor } from '../editor/markdown-grammar.js';
import { scanMathRanges } from '../editor/math/range-scanner.js';

const excluded = 'pre, code, kbd, script, style, textarea, table, .math, mjx-container, .MathJax, svg, .callout-title, .footnote-ref, .footnote-backref';
const generated = '.math, mjx-container, .MathJax, svg, .callout-title, .footnote-ref, .footnote-backref';
const wikiGrammar = {
 defineNodes: ['ReadingWiki'],
 parseInline: [{ name: 'ReadingWiki', before: 'Link', parse(context: import('@lezer/markdown').InlineContext, next: number, position: number) {
  if (next !== 91 || context.char(position + 1) !== 91) return -1;
  const text = context.slice(position, context.end), close = text.indexOf(']]');
  if (close < 0 || /[\r\n]/u.test(text.slice(0, close))) return -1;
  return context.addElement(context.elt('ReadingWiki', position, position + close + 2));
 } }],
};

/** Reading emits both an HTML break and a softbreak for the same physical newline. */
export function createReadingLineBreakDisplay(): (root: HTMLElement, source: string | null, owns?: (element: Element) => boolean) => () => void {
 const owners = new WeakMap<HTMLBRElement, { users: number; hidden: boolean }>();
 return (root, source, owns = () => true) => {
  if (source === null) return () => {};
  const tags: { from: number; to: number }[] = [];
  const hidden = new Uint8Array(source.length);
  parser.configure([GFM, metadataGrammar, wikiGrammar, nativeInlineGrammarFor(scanMathRanges(source).expressions)])
   .parse(source).iterate({ enter(node) {
    if (/^(?:CalloutNative|Comment)/u.test(node.name) || node.name.endsWith('Mark') ||
     ['HTMLTag', 'LinkTitle', 'LinkLabel', 'LinkReference', 'Image'].includes(node.name) ||
     node.name === 'URL' && node.node.parent?.name === 'Link') hidden.fill(1, node.from, node.to);
    if (node.name === 'ReadingWiki') {
     const pipe = source.indexOf('|', node.from + 2);
     hidden.fill(1, node.from, pipe >= 0 && pipe < node.to - 2 ? pipe + 1 : node.from + 2);
     hidden.fill(1, node.to - 2, node.to);
    }
    if (node.name === 'Paragraph' && node.node.parent?.name === 'Blockquote' && /^\[![^\]\r\n]+\][+-]?(?:\s|$)/u.test(source.slice(node.from, node.to))) {
     const end = source.indexOf('\n', node.from);
     hidden.fill(1, node.from, end < 0 ? node.to : Math.min(end, node.to));
    }
    if (node.name === 'HTMLTag' && /^<br[ \t]*\/?[ \t]*>$/iu.test(source.slice(node.from, node.to)))
     tags.push({ from: node.from, to: node.to });
   } });
  const runs: { from: number; to: number; count: number }[] = [];
  for (let index = 0; index < tags.length; index++) {
   const first = tags[index]!;
   let last = first, count = 1;
   while (tags[index + 1]?.from === last.to) { last = tags[++index]!; count++; }
   const newline = /^\r?\n/u.exec(source.slice(last.to));
   if (newline) runs.push({ from: first.from, to: last.to + newline[0].length, count });
  }
  if (!runs.length) return () => {};

  // Project visible source text first: destinations, aliases and HTML attributes
  // cannot compete with real content when words occur more than once.
  const offsets: number[] = [];
  let decoded = '';
  for (let position = 0; position < source.length; position++) {
   if (hidden[position]) continue;
   const entity = source[position] === '&' ? /^&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);/iu.exec(source.slice(position)) : null;
   if (entity) {
    // eslint-disable-next-line no-unsanitized/method -- Validated character references contain no markup delimiters.
    const text = root.ownerDocument.createRange().createContextualFragment(entity[0]).textContent;
    for (let index = 0; index < text.length; index++) offsets.push(position);
    decoded += text; position += entity[0].length - 1; continue;
   }
   if (source[position] === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/u.test(source[position + 1] ?? '')) position++;
   offsets.push(position); decoded += source[position];
  }
  const positions = new Map<Text, { from: number; to: number }>();
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const texts: Text[] = [];
  let cursor = 0;
  while (walker.nextNode()) {
   const node = walker.currentNode as Text;
   texts.push(node);
   if (node.parentElement?.closest(generated)) continue;
   const text = node.data.trim();
   if (!text) continue;
   const index = decoded.indexOf(text, cursor);
   if (index < 0) continue;
   cursor = index + text.length;
   positions.set(node, { from: offsets[index]!, to: offsets[cursor - 1]! + 1 });
  }
  const acquired = new Set<HTMLBRElement>();
  for (const first of root.querySelectorAll<HTMLBRElement>('br')) {
   if (!owns(first)) continue;
   if (first.closest(excluded) || first.previousSibling?.nodeName === 'BR') continue;
   const group = [first];
   while (group.at(-1)!.nextSibling?.nodeName === 'BR') group.push(group.at(-1)!.nextSibling as HTMLBRElement);
   if (group.length < 2) continue;
   const last = group.at(-1)!;
   const before = [...texts].reverse().find(node => !!(node.compareDocumentPosition(first) & 4) && positions.has(node));
   const after = texts.find(node => !!(last.compareDocumentPosition(node) & 4) && positions.has(node));
   if (!before || !after) continue;
   const candidates = runs.filter(run => positions.get(before)!.to <= run.from && run.to <= positions.get(after)!.from);
   if (candidates.length !== 1 || candidates[0]!.count + 1 !== group.length) continue;
   let owner = owners.get(last);
   if (!owner) { owner = { users: 0, hidden: last.hidden }; owners.set(last, owner); }
   owner.users++; acquired.add(last); last.hidden = true;
  }
  return () => {
   for (const element of acquired) {
    const owner = owners.get(element)!;
    if (--owner.users) continue;
    element.hidden = owner.hidden; owners.delete(element);
   }
  };
 };
}
