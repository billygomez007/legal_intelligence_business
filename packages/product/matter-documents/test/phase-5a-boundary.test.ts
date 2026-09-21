import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

describe('Matter Documents Phase 5A source boundary', () => {
  const source = sourceFiles(new URL('../src', import.meta.url).pathname)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  it('does not import the public corpus or entitlement packages', () => {
    expect(source).not.toMatch(/@legalintel\/legal-corpus/);
    expect(source).not.toMatch(/@legalintel\/entitlements/);
  });

  it('does not implement OCR, embeddings, retrieval, or AI execution', () => {
    expect(source).not.toMatch(
      /tesseract|textract|embedding|vector search|semantic search|executeAi|runAi/i,
    );
  });

  it('does not implement public corpus publication', () => {
    expect(source).not.toMatch(/publishToCorpus|publicCorpusPublication|corpusPublisher/i);
  });

  it('does not implement country-selection behavior', () => {
    expect(source).not.toMatch(
      /Nigeria|jurisdictionCodes\s*=\s*\[[^\]]*,|countrySelector|countrySelection/i,
    );
  });
});
