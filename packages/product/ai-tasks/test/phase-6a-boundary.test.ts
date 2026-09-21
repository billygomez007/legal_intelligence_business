import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const candidate = join(directory, name);

    if (statSync(candidate).isDirectory()) {
      return sourceFiles(candidate);
    }

    return candidate.endsWith('.ts') ? [candidate] : [];
  });
}

const productionSource = sourceFiles(sourceRoot)
  .map((fileName) => readFileSync(fileName, 'utf8'))
  .join('\n');

describe('AI Tasks Phase 6A source boundary', () => {
  it('does not implement retrieval, embeddings, model execution or work products', () => {
    expect(productionSource).not.toMatch(
      /pgvector|embedding|rerank|retriev|OpenAI|Anthropic|work[_ -]?product/i,
    );
  });

  it('does not implement OCR, extraction or external actions', () => {
    expect(productionSource).not.toMatch(/\bOCR\b|tesseract|extractText|external action/i);
  });

  it('does not add another country', () => {
    expect(productionSource).not.toMatch(/\bNigeria\b|\bNigerian\b|['"]NG['"]/i);
  });

  it('keeps Phase 6A free of production imports from retrieval-side product packages', () => {
    expect(productionSource).not.toContain('@legalintel/knowledge');
    expect(productionSource).not.toContain('@legalintel/matter-documents');
    expect(productionSource).not.toContain('@legalintel/legal-corpus');
  });
});
