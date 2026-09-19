import { describe, expect, it } from 'vitest';

import {
  codePoints,
  IngestionFailure,
  labelledParser,
  MAX_PASSAGES,
  validateParsed,
  type Extraction,
  type ParsedDocument,
} from '../src';
import { chr, requestFor, SYNTHETIC_ACT } from './support';

const request = requestFor(SYNTHETIC_ACT);
const extraction = (text: string): Extraction => ({
  text,
  extractorVersion: 'test',
  quality: 1,
  warnings: [],
});
const parse = (text: string) => labelledParser.parse(extraction(text), request);
const failsWith = (fn: () => unknown, category: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(IngestionFailure);
    expect((error as IngestionFailure).category).toBe(category);
    return;
  }
  throw new Error('expected a failure');
};
const slice = (text: string, start: number, end: number) =>
  codePoints(text).slice(start, end).join('');

describe('labelled parser: structure', () => {
  it('produces one passage per non-empty line, in order, each pointing back at the source text', () => {
    const parsed = parse(SYNTHETIC_ACT);
    expect(parsed.passages.map((p) => p.text)).toEqual(
      SYNTHETIC_ACT.split('\n').filter((line) => line !== ''),
    );
    parsed.passages.forEach((passage, index) => {
      expect(passage.ordinal).toBe(index);
      expect(slice(SYNTHETIC_ACT, passage.start, passage.end)).toBe(passage.text);
    });
  });

  it('records where each passage sits: page, section and paragraph', () => {
    const parsed = parse(SYNTHETIC_ACT);
    const paragraphOne = parsed.passages.find((p) => p.text.startsWith('1. '));
    expect(paragraphOne?.locator).toBe('page:1/PART 1/paragraph:1');
  });

  it('advances the page at a form feed, whether on its own line or starting a line', () => {
    const text = [
      'Title: SYNTHETIC paged document',
      '1. First paragraph on the first page.',
      chr(0x0c),
      '2. Second paragraph on the second page.',
      chr(0x0c) + '3. Third paragraph on the third page.',
    ].join('\n');
    const pages = parse(text).passages.map((p) => /page:(\d+)/.exec(p.locator)?.[1]);
    expect(pages).toEqual(['1', '1', '2', '3']);
  });

  it('is deterministic: identical input gives identical output', () => {
    expect(parse(SYNTHETIC_ACT)).toEqual(parse(SYNTHETIC_ACT));
  });

  it('counts offsets in code points, so characters outside the BMP do not shift evidence', () => {
    const astral = chr(0x1d518, 0x1d519);
    const text = `Title: ${astral} SYNTHETIC Act\n1. A ${astral} fictional widget must be registered.`;
    const parsed = parse(text);
    const title = parsed.fields.find((f) => f.field === 'title');
    expect(title?.value).toBe(`${astral} SYNTHETIC Act`);
    expect(slice(text, title?.start ?? 0, title?.end ?? 0)).toBe(title?.value);
    expect(() => {
      validateParsed(text, parsed);
    }).not.toThrow();
    // Counting UTF-16 units instead would land in the wrong place.
    expect(text.slice(title?.start, title?.end)).not.toBe(title?.value);
  });

  it('refuses a document with no content, and one with more passages than the platform will hold', () => {
    failsWith(() => parse('   \n\n   \n'), 'parse_failed');
    const many = ['Title: SYNTHETIC large'].concat(
      Array.from({ length: MAX_PASSAGES + 1 }, (_, i) => `${i + 1}. A fictional provision.`),
    );
    failsWith(() => parse(many.join('\n')), 'parse_failed');
  });

  it('refuses a single line too long to be a sensible passage', () => {
    failsWith(() => parse(`Title: SYNTHETIC\n${'x'.repeat(8001)}`), 'parse_failed');
  });

  it('runs in linear time on adversarial input', () => {
    const started = performance.now();
    parse('Title: SYNTHETIC\n' + '1'.repeat(7999) + '\n' + '[1' + ' '.repeat(7000) + 'x');
    parse('Title: SYNTHETIC\n' + 'PART '.repeat(1500));
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('labelled parser: metadata', () => {
  it('extracts only what is labelled, as parser output that nobody has reviewed', () => {
    const parsed = parse(SYNTHETIC_ACT);
    expect(parsed.fields.map((f) => f.field).sort()).toEqual([
      'identifier',
      'jurisdiction',
      'title',
    ]);
    for (const field of parsed.fields) {
      expect(field.origin).toBe('parser');
      expect(field.reviewState).toBe('unreviewed');
      expect(field.value).toBe(field.quote);
    }
    expect(parsed.warnings).toContain('metadata_requires_human_review');
  });

  it('never invents a field that is absent', () => {
    const parsed = parse('Title: SYNTHETIC minimal\n1. A fictional provision of some length.');
    expect(parsed.fields.map((f) => f.field)).toEqual(['title']);
  });

  it('refuses a label that appears twice or has no value, rather than choosing', () => {
    failsWith(
      () => parse('Title: SYNTHETIC one\nTitle: SYNTHETIC two\n1. A fictional provision here.'),
      'metadata_invalid',
    );
    failsWith(() => parse('Title:\n1. A fictional provision of some length.'), 'metadata_invalid');
  });

  it('ignores unknown labels instead of guessing what they mean', () => {
    const parsed = parse(
      'Title: SYNTHETIC x\nColour: blue\n1. A fictional provision of some length.',
    );
    expect(parsed.fields.map((f) => f.field)).toEqual(['title']);
  });
});

describe('labelled parser: citations', () => {
  const text = [
    'Title: SYNTHETIC citing document',
    '1. As held in the fictional matter. Cites: SYN/CASE/9 and later Cites: SYN/ACT/1',
  ].join('\n');

  it('detects only explicit citation labels, with the exact text and position as evidence', () => {
    const parsed = parse(text);
    expect(parsed.citations.map((c) => c.identifier)).toEqual(['SYN/CASE/9', 'SYN/ACT/1']);
    for (const citation of parsed.citations) {
      const passage = parsed.passages[citation.passageOrdinal];
      expect(slice(passage?.text ?? '', citation.start, citation.end)).toBe(citation.quote);
    }
  });

  it('asserts nothing about how the cited authority was treated', () => {
    const parsed = parse(text);
    for (const citation of parsed.citations) {
      expect(Object.keys(citation).sort()).toEqual(
        ['confidence', 'end', 'identifier', 'passageOrdinal', 'quote', 'start'].sort(),
      );
    }
    expect(text.includes('overruled')).toBe(false);
  });

  it('does not treat prose that merely resembles a citation as one', () => {
    const parsed = parse(
      'Title: SYNTHETIC x\n1. See also SYN/CASE/9 and the fictional Act 1 of 2000.',
    );
    expect(parsed.citations).toEqual([]);
  });
});

describe('validation before anything is stored', () => {
  const good = () => structuredClone(parse(SYNTHETIC_ACT));
  const failsValidation = (
    mutate: (doc: ParsedDocument) => void,
    category = 'validation_failed',
  ) => {
    const doc = good();
    mutate(doc);
    failsWith(() => {
      validateParsed(SYNTHETIC_ACT, doc);
    }, category);
  };

  it('accepts what the parser produced', () => {
    expect(() => {
      validateParsed(SYNTHETIC_ACT, good());
    }).not.toThrow();
  });

  it('refuses a metadata quote that is not the text at its stated position', () => {
    failsValidation((doc) => {
      const title = doc.fields.find((f) => f.field === 'title');
      if (title) title.start += 1;
    });
    failsValidation((doc) => {
      const title = doc.fields.find((f) => f.field === 'title');
      if (title) title.quote = 'SYNTHETIC Test Act 2';
    });
  });

  it('refuses metadata that claims to have been reviewed: machine output is never verified', () => {
    failsValidation((doc) => {
      const title = doc.fields[0];
      if (title) (title as { reviewState: string }).reviewState = 'verified';
    });
  });

  it('refuses a missing title', () => {
    failsValidation((doc) => {
      doc.fields = doc.fields.filter((f) => f.field !== 'title');
    }, 'metadata_invalid');
  });

  it('refuses duplicate fields, out-of-order passages and impossible confidence', () => {
    failsValidation((doc) => {
      const first = doc.fields[0];
      if (first) doc.fields.push({ ...first });
    });
    failsValidation((doc) => {
      doc.passages.reverse();
    });
    failsValidation((doc) => {
      const first = doc.fields[0];
      if (first) first.confidence = 1.5;
    });
  });

  it('refuses a passage whose text is not the source text at its offsets', () => {
    failsValidation((doc) => {
      const passage = doc.passages[2];
      if (passage) passage.text = 'A fabricated provision that is not in the document.';
    });
  });

  it('refuses a citation that does not point at real text inside its passage', () => {
    const doc = structuredClone(parse('Title: SYNTHETIC x\n1. As held. Cites: SYN/CASE/9'));
    const citation = doc.citations[0];
    if (citation) citation.start += 2;
    failsWith(() => {
      validateParsed('Title: SYNTHETIC x\n1. As held. Cites: SYN/CASE/9', doc);
    }, 'validation_failed');
  });
});
