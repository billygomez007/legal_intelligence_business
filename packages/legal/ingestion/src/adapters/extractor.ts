import { Worker } from 'node:worker_threads';

import {
  IngestionFailure,
  MAX_BYTES,
  MAX_TEXT,
  MIN_VISIBLE_CHARACTERS,
  type Extraction,
  type MediaType,
} from '../domain/model';
import type { TextExtractor } from '../ports/pipeline';

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

/**
 * Tree-building HTML parsing is CPU-bound and, on hostile markup, quadratic: measured on this
 * code, 1.3 MB of table cells took about 11 seconds and a single tag with 100,000 attributes
 * about 20. A synchronous parse cannot be interrupted, and a worker frozen on one document
 * holds its job lock and starves every other job. So the parse runs in a worker thread with a
 * deadline and a memory ceiling; on either, the thread is terminated and the document ends as a
 * typed `extraction_failed`.
 */
export const HTML_EXTRACTION_TIMEOUT_MS = 10_000;

interface HtmlTextResult {
  ok: boolean;
  text?: string;
  hiddenDropped?: boolean;
}

function htmlText(
  input: string,
  timeoutMs: number,
): Promise<{ text: string; hiddenDropped: boolean }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./html-text-worker.mjs', import.meta.url), {
      workerData: { input },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      outcome();
    };
    const fail = () => {
      finish(() => {
        reject(new IngestionFailure('extraction_failed'));
      });
    };
    const timer = setTimeout(fail, timeoutMs);
    worker.once('message', (result: HtmlTextResult) => {
      if (result.ok && result.text !== undefined) {
        const value = { text: result.text, hiddenDropped: result.hiddenDropped === true };
        finish(() => {
          resolve(value);
        });
      } else {
        fail();
      }
    });
    worker.once('error', fail);
    worker.once('exit', fail); // exited without a message: crashed, out of memory or terminated
  });
}

/**
 * Plain text and HTML. PDF is refused as `unsupported_format` (a reviewable outcome, not a
 * crash): extracting a PDF safely needs an isolated worker, which is a separate decision.
 */
export class BasicTextExtractor implements TextExtractor {
  constructor(private readonly options: { htmlTimeoutMs?: number } = {}) {}

  /** Rejects, never throws synchronously: callers of a port may rely on the promise alone. */
  async extract(bytes: Uint8Array, mediaType: MediaType): Promise<Extraction> {
    const input = this.decode(bytes, mediaType);
    const warnings: string[] = [];
    let extracted = input;
    if (mediaType === 'text/html') {
      const html = await htmlText(input, this.options.htmlTimeoutMs ?? HTML_EXTRACTION_TIMEOUT_MS);
      extracted = html.text;
      warnings.push('html_layout_not_preserved');
      if (html.hiddenDropped) warnings.push('html_hidden_content_dropped');
    }
    return this.normalise(extracted, mediaType, warnings);
  }

  /** Size, media type and encoding checks, then the decoded string. */
  private decode(bytes: Uint8Array, mediaType: MediaType): string {
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
    return input;
  }

  private normalise(extracted: string, mediaType: MediaType, warnings: string[]): Extraction {
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
      extractorVersion: mediaType === 'text/html' ? 'html-parse5-8.0.1-v3' : 'utf8-v1',
      quality: Math.min(1, visible / Math.max(1, text.trim().length)),
      warnings,
    };
  }
}
