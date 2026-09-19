import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import {
  IngestionFailure,
  MAX_BYTES,
  MAX_TEXT,
  type Extraction,
  type MediaType,
} from '../domain/model';
import type { TextExtractor } from '../ports/pipeline';

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

function htmlText(input: string): string {
  const root = parse(input);
  const output: string[] = [];
  // Iterative traversal bounds call-stack use on adversarial deeply nested markup.
  const stack: { node: DefaultTreeAdapterTypes.Node; end: boolean }[] = [
    { node: root, end: false },
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    const { node, end } = item;
    if (++nodes > 100_000) throw new IngestionFailure('extraction_failed');
    if ('tagName' in node) {
      if (
        DROP.has(node.tagName) ||
        node.attrs.some((a) => a.name === 'hidden' || a.name === 'style')
      )
        continue;
      if (BLOCK.has(node.tagName)) output.push('\n');
    }
    if (end) continue;
    if ('value' in node && node.nodeName === '#text') output.push(node.value);
    if ('childNodes' in node) {
      stack.push({ node, end: true });
      for (const child of [...node.childNodes].reverse()) stack.push({ node: child, end: false });
    }
  }
  return output.join('');
}

export class BasicTextExtractor implements TextExtractor {
  async extract(bytes: Uint8Array, mediaType: MediaType): Promise<Extraction> {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES)
      throw new IngestionFailure('input_invalid');
    if (mediaType === 'application/pdf') throw new IngestionFailure('unsupported_format');
    let input: string;
    try {
      input = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new IngestionFailure('extraction_failed');
    }
    if (input.startsWith('%PDF-') || input.includes('\0'))
      throw new IngestionFailure('extraction_failed');
    const extracted = mediaType === 'text/html' ? htmlText(input) : input;
    const text = extracted
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\u00a0]+/g, ' ')
      .normalize('NFC');
    if (text.length > MAX_TEXT || /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/u.test(text))
      throw new IngestionFailure('extraction_failed');
    const visible = [...text].filter((c) => /[\p{L}\p{N}]/u.test(c)).length;
    if (visible < 20) throw new IngestionFailure('extraction_quality_low');
    return {
      text,
      extractorVersion: mediaType === 'text/html' ? 'html-parse5-8.0.1-v1' : 'utf8-v1',
      quality: Math.min(1, visible / Math.max(1, text.trim().length)),
      warnings: mediaType === 'text/html' ? ['html_layout_not_preserved'] : [],
    };
  }
}
