import { describe, expect, it } from 'vitest';

import * as matterDocuments from '../src';

describe('Matter Documents package contract', () => {
  it('exports its migration set', () => {
    expect(matterDocuments.matterDocumentMigrations).toBeDefined();
    expect(matterDocuments.matterDocumentMigrations.name).toBe('matter_documents');
  });

  it('does not expose country-selection behavior', () => {
    const exportedNames = Object.keys(matterDocuments);

    expect(
      exportedNames.some((name) =>
        /nigeria|countrySelector|countrySelection|resolveCountry/i.test(name),
      ),
    ).toBe(false);
  });

  it('does not expose public-corpus publication behavior', () => {
    const exportedNames = Object.keys(matterDocuments);

    expect(
      exportedNames.some((name) => /publishToCorpus|publicCorpus|corpusPublication/i.test(name)),
    ).toBe(false);
  });

  it('does not expose OCR, embedding, retrieval, or AI execution behavior', () => {
    const exportedNames = Object.keys(matterDocuments);

    expect(exportedNames.some((name) => /ocr|embedding|retriev|executeAi|runAi/i.test(name))).toBe(
      false,
    );
  });
});
