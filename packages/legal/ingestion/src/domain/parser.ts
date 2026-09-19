import type { DocumentParser } from '../ports/pipeline';
import {
  codePointLength,
  codePoints,
  IngestionFailure,
  MAX_PASSAGES,
  type DerivedField,
  type ParsedDocument,
  type Segment,
} from './model';

const LABELS: Readonly<Record<string, string>> = {
  Title: 'title',
  Identifier: 'identifier',
  Court: 'court',
  Jurisdiction: 'jurisdiction',
  'Case number': 'case_number',
  'Decision date': 'decision_date',
  Judges: 'judges',
  Parties: 'parties',
  'Enactment date': 'enactment_date',
  Commencement: 'commencement',
  Amendment: 'amendment',
};

/** Conservative labelled metadata and line structure. Nothing missing is guessed. */
export const labelledParser: DocumentParser = {
  id: 'labelled-v1',
  parse(extraction) {
    const fields: DerivedField[] = [];
    const passages: Segment[] = [];
    let offset = 0;
    let page = 1;
    let section = 'preamble';
    for (const raw of extraction.text.split('\n')) {
      // A form feed starts a new page. It is whitespace, so it must be counted before blank
      // lines are skipped or the page number never advances.
      page += raw.split('\f').length - 1;
      const line = raw.trim();
      const start = offset + codePointLength(raw.slice(0, raw.indexOf(line)));
      offset += codePointLength(raw) + 1;
      if (line === '') continue;
      if (line.length > 8000) throw new IngestionFailure('parse_failed');
      const heading = /^(?:PART\s+\S+|SCHEDULE\s*\S*|Section\s+[\w.-]+|ORDERS?|JUDGMENT)\b/i.exec(
        line,
      );
      if (heading !== null) section = heading[0];
      const paragraph = /^\[?(\d+[a-z]?)\]?[.)]?\s/.exec(line)?.[1];
      const locator = `page:${page}/${section}/paragraph:${paragraph ?? passages.length}`;
      passages.push({
        ordinal: passages.length,
        locator,
        text: line,
        start,
        end: start + codePointLength(line),
      });
      const colon = line.indexOf(':');
      const name = LABELS[line.slice(0, colon)];
      if (colon > 0 && name !== undefined) {
        const value = line.slice(colon + 1).trim();
        if (value === '' || value.length > 1000 || fields.some((f) => f.field === name)) {
          throw new IngestionFailure('metadata_invalid');
        }
        const valueStart = start + codePointLength(line.slice(0, line.indexOf(value, colon + 1)));
        fields.push({
          field: name,
          value,
          quote: value,
          start: valueStart,
          end: valueStart + codePointLength(value),
          origin: 'parser',
          confidence: 1,
          reviewState: 'unreviewed',
        });
      }
    }
    if (passages.length === 0 || passages.length > MAX_PASSAGES)
      throw new IngestionFailure('parse_failed');
    const citations: ParsedDocument['citations'] = [];
    for (const passage of passages) {
      // Explicit citation labels are suitable for controlled source adapters. No treatment inference.
      for (const match of passage.text.matchAll(/Cites:\s*([A-Za-z0-9][A-Za-z0-9_.:/-]{0,199})/g)) {
        const identifier = match[1];
        if (identifier === undefined) continue;
        const start = codePointLength(
          passage.text.slice(0, match.index + match[0].indexOf(identifier)),
        );
        citations.push({
          passageOrdinal: passage.ordinal,
          identifier,
          quote: identifier,
          start,
          end: start + codePointLength(identifier),
          confidence: 1,
        });
      }
    }
    return {
      fields,
      passages,
      citations,
      concepts: [],
      warnings: ['metadata_requires_human_review'],
    };
  },
};

export function validateParsed(text: string, parsed: ParsedDocument): void {
  const points = codePoints(text);
  const title = parsed.fields.find((f) => f.field === 'title');
  if (title === undefined || title.value.trim() === '')
    throw new IngestionFailure('metadata_invalid');
  if (parsed.passages.length === 0 || parsed.passages.length > MAX_PASSAGES)
    throw new IngestionFailure('validation_failed');
  const evidence = (full: readonly string[], start: number, end: number, quote: string) => {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > full.length ||
      full.slice(start, end).join('') !== quote
    )
      throw new IngestionFailure('validation_failed');
  };
  const names = new Set<string>();
  for (const field of parsed.fields) {
    evidence(points, field.start, field.end, field.quote);
    if (
      field.value !== field.quote ||
      names.has(field.field) ||
      !/^[a-z_]{1,64}$/.test(field.field) ||
      // The type says 'unreviewed', but parsers are adapters: check what they actually returned.
      (field.reviewState as string) !== 'unreviewed' ||
      field.confidence < 0 ||
      field.confidence > 1
    )
      throw new IngestionFailure('validation_failed');
    names.add(field.field);
  }
  let previousEnd = 0;
  parsed.passages.forEach((p, i) => {
    evidence(points, p.start, p.end, p.text);
    if (p.ordinal !== i || p.start < previousEnd || p.locator.length > 200)
      throw new IngestionFailure('validation_failed');
    previousEnd = p.end;
  });
  for (const citation of parsed.citations) {
    const p = parsed.passages[citation.passageOrdinal];
    if (p === undefined || citation.identifier !== citation.quote)
      throw new IngestionFailure('validation_failed');
    evidence(codePoints(p.text), citation.start, citation.end, citation.quote);
  }
  for (const concept of parsed.concepts)
    evidence(points, concept.start, concept.end, concept.quote);
}
