import { describe, expect, it } from 'vitest';
import { emptySearch, webClients } from '../src/data/mock-clients';
describe('mock adapter boundary', () => {
  it('uses only clearly synthetic titles, identifiers, sources and public demo scope', async () => {
    for (const authority of await webClients.authorities.list()) {
      expect(authority.title).toMatch(/^(Sample|Example) /);
      expect(authority.identifier).toMatch(/^DEMO-/);
      expect(authority.source).toContain('synthetic');
      expect(authority.demonstration).toBe(true);
      expect(authority.scope).toBe('public-demo');
    }
  });
  it('filters every search dimension and returns no matches for unsupported values', async () => {
    expect(await webClients.search.search({ ...emptySearch, text: 'Contract' })).toHaveLength(1);
    for (const [key, value] of Object.entries({
      jurisdiction: 'Ghana',
      court: 'Example Court • synthetic',
      kind: 'case',
      year: '2025',
      practiceArea: 'Contract',
      concept: 'Breach of contract',
    })) {
      const result = await webClients.search.search({ ...emptySearch, [key]: value });
      expect(result.length).toBeGreaterThan(0);
      expect(await webClients.search.search({ ...emptySearch, [key]: 'unsupported' })).toHaveLength(
        0,
      );
    }
    expect(
      await webClients.search.search({ ...emptySearch, kind: 'legislation', year: '2025' }),
    ).toHaveLength(0);
  });
  it('resolves all answer and project citations to existing source passages', async () => {
    const answer = await webClients.research.exampleAnswer();
    for (const citation of answer.citations) {
      const source = await webClients.authorities.source(citation.authorityId);
      expect(source).toBeDefined();
      expect(source?.passageIds).toContain(citation.passageId);
    }
    for (const project of await webClients.research.list()) {
      const sources = await Promise.all(
        project.authorityIds.map((id) => webClients.authorities.source(id)),
      );
      for (const id of project.passageIds)
        expect(sources.flatMap((s) => s?.passageIds ?? [])).toContain(id);
    }
    expect(answer.model).toBe('none');
    expect(answer.retrievalIds).toEqual([]);
  });
  it('does not leak passage data for unavailable or restricted sources', async () => {
    for (const id of ['sample-employment', 'sample-land']) {
      const source = await webClients.authorities.source(id);
      expect(source?.passages).toEqual([]);
      expect(source?.passageIds).toEqual([]);
    }
    for (const result of await webClients.search.search(emptySearch))
      if (result.authority.rights !== 'available') expect(result.matchingPassageIds).toEqual([]);
  });
  it('returns undefined for unknown records and never shares mutable fixture objects', async () => {
    expect(await webClients.authorities.get('missing')).toBeUndefined();
    expect(await webClients.authorities.source('missing')).toBeUndefined();
    expect(await webClients.research.get('missing')).toBeUndefined();
    const record = await webClients.authorities.get('sample-contract');
    if (!record) throw new Error('Missing fixture');
    record.title = 'Changed';
    expect((await webClients.authorities.get(record.id))?.title).toBe('Sample Contract Dispute');
  });
});
