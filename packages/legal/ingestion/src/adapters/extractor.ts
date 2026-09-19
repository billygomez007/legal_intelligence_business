import { parse, type DefaultTreeAdapterTypes } from 'parse5';

import {
  IngestionFailure,
  MAX_BYTES,
  MAX_TEXT,
  MIN_VISIBLE_CHARACTERS,
  type Extraction,
  type MediaType,
} from '../domain/model';
import type { TextExtractor } from '../ports/pipeline';

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
const isHidden = (node: DefaultTreeAdapterTypes.Element): boolean =>
  node.attrs.some((a) => a.name === 'hidden' || (a.name === 'style' && HIDING_STYLE.test(a.value)));

/**
 * Characters that can make displayed text differ from stored text (bidirectional overrides,
 * zero-width joiners). They are kept, because removing them would alter the source, and
 * reported, so a reviewer looks at that text with that in mind.
 */
const BIDI_CONTROLS = new Set([
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);
const INVISIBLE = new Set([0x200b, 0x200d, 0x2060, 0xfeff]);

/**
 * C0 controls and DEL other than tab, line feed, form feed and carriage return. Extracted text
 * that contains them is not text a person wrote (it is binary, or an attempt to mislead a
 * terminal or a log), so it is refused rather than stored.
 */
const isForbiddenControl = (point: number): boolean =>
  point <= 0x08 || point === 0x0b || (point >= 0x0e && point <= 0x1f) || point === 0x7f;

interface CharacterSurvey {
  forbiddenControl: boolean;
  bidiControl: boolean;
  invisible: boolean;
  visible: number;
}
/** One pass over the code points: what is present, and how many are letters or digits. */
function survey(text: string): CharacterSurvey {
  const result: CharacterSurvey = {
    forbiddenControl: false,
    bidiControl: false,
    invisible: false,
    visible: 0,
  };
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (isForbiddenControl(point)) result.forbiddenControl = true;
    else if (BIDI_CONTROLS.has(point)) result.bidiControl = true;
    else if (INVISIBLE.has(point)) result.invisible = true;
    else if (/[\p{L}\p{N}]/u.test(character)) result.visible += 1;
  }
  return result;
}

function htmlText(input: string): { text: string; hiddenDropped: boolean } {
  const root = parse(input);
  const output: string[] = [];
  let hiddenDropped = false;
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
  return { text: output.join(''), hiddenDropped };
}

/**
 * Plain text and HTML. PDF is refused as `unsupported_format` (a reviewable outcome, not a
 * crash): extracting a PDF safely needs an isolated worker, which is a separate decision.
 */
export class BasicTextExtractor implements TextExtractor {
  /** Rejects, never throws synchronously: callers of a port may rely on the promise alone. */
  extract(bytes: Uint8Array, mediaType: MediaType): Promise<Extraction> {
    try {
      return Promise.resolve(this.extractSync(bytes, mediaType));
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new IngestionFailure('extraction_failed'),
      );
    }
  }

  private extractSync(bytes: Uint8Array, mediaType: MediaType): Extraction {
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

    const warnings: string[] = [];
    let extracted = input;
    if (mediaType === 'text/html') {
      const html = htmlText(input);
      extracted = html.text;
      warnings.push('html_layout_not_preserved');
      if (html.hiddenDropped) warnings.push('html_hidden_content_dropped');
    }
    const text = extracted
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\xa0]+/g, ' ')
      .normalize('NFC');
    if (text.length > MAX_TEXT) throw new IngestionFailure('extraction_failed');
    const characters = survey(text);
    if (characters.forbiddenControl) throw new IngestionFailure('extraction_failed');
    if (characters.bidiControl) warnings.push('bidirectional_control_characters_present');
    if (characters.invisible) warnings.push('invisible_characters_present');

    const visible = characters.visible;
    if (visible < MIN_VISIBLE_CHARACTERS) throw new IngestionFailure('extraction_quality_low');
    return {
      text,
      extractorVersion: mediaType === 'text/html' ? 'html-parse5-8.0.1-v2' : 'utf8-v1',
      quality: Math.min(1, visible / Math.max(1, text.trim().length)),
      warnings,
    };
  }
}
