// Turns an HTML document into plain text. Runs in a worker thread (see html-text-worker.mjs),
// never on the caller's event loop: tree construction is CPU-bound and, on hostile markup,
// quadratic (a 1.3 MB run of table cells takes about 11 seconds; a tag with 100,000 attributes
// takes about 20), and a synchronous parse cannot be interrupted. A worker can be terminated.
//
// Plain JavaScript on purpose: a worker is loaded by Node directly, without the TypeScript
// toolchain. It is pure and has no I/O.

import { parse } from 'parse5';

/** Elements that never carry document text. Dropping them is not content loss. */
const DROP = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'head',
]);
const BLOCK = new Set([
  'p',
  'div',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'li',
  'tr',
  'br',
  'hr',
  'pre',
]);

/**
 * Only markup that hides content from a reader. An arbitrary `style` attribute is NOT a reason
 * to drop an element: legal HTML routinely carries `style="text-align:center"` on real text,
 * and dropping it would silently lose part of the document.
 */
const HIDING_STYLE =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i;

/** @param {{ attrs: { name: string, value: string }[] }} node */
const isHidden = (node) =>
  node.attrs.some((a) => a.name === 'hidden' || (a.name === 'style' && HIDING_STYLE.test(a.value)));

/** Upper bound on nodes visited, so a markup bomb ends in a typed failure. */
export const MAX_NODES = 100_000;

/**
 * @param {string} input
 * @returns {{ ok: true, text: string, hiddenDropped: boolean } | { ok: false, reason: 'too_many_nodes' }}
 */
export function htmlText(input) {
  const root = parse(input);
  /** @type {string[]} */
  const output = [];
  let hiddenDropped = false;
  // Iterative traversal bounds call-stack use on adversarial deeply nested markup.
  /** @type {{ node: any, end: boolean }[]} */
  const stack = [{ node: root, end: false }];
  let nodes = 0;
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    const { node, end } = item;
    if (++nodes > MAX_NODES) return { ok: false, reason: 'too_many_nodes' };
    if ('tagName' in node) {
      if (DROP.has(node.tagName)) continue;
      if (isHidden(node)) {
        // Hidden text is a known way to smuggle instructions to a machine reader, so it is
        // not extracted, and its presence is reported rather than passed over silently.
        hiddenDropped = true;
        continue;
      }
      if (BLOCK.has(node.tagName)) output.push('\n');
    }
    if (end) continue;
    if ('value' in node) output.push(node.value);
    if ('childNodes' in node) {
      stack.push({ node, end: true });
      for (const child of node.childNodes.toReversed()) stack.push({ node: child, end: false });
    }
  }
  return { ok: true, text: output.join(''), hiddenDropped };
}
