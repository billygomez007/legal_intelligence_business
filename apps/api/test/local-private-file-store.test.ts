import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLocalPrivateFileStore } from '../src/storage/local-private-file-store.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(
      root,

      {
        recursive: true,

        force: true,
      },
    );
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'law-afrique-private-'));

  roots.push(root);

  return {
    root,

    store: createLocalPrivateFileStore(root),
  };
}

describe('Law Afrique local private file storage', () => {
  it('persists exact bytes outside any public web path', async () => {
    const { root, store } = await fixture();

    const bytes = new TextEncoder().encode('confidential legal file');

    const stored = await store.put({
      organizationId: '11111111-1111-4111-8111-111111111111',

      documentId: '22222222-2222-4222-8222-222222222222',

      bytes,
    });

    const saved = await readFile(join(root, stored.storageKey));

    expect([...saved]).toEqual([...bytes]);

    expect(stored.storageKey).not.toContain('..');
  });

  it('writes private files with owner-only permissions', async () => {
    const { root, store } = await fixture();

    const stored = await store.put({
      organizationId: '11111111-1111-4111-8111-111111111111',

      documentId: '22222222-2222-4222-8222-222222222222',

      bytes: new Uint8Array([1, 2, 3]),
    });

    const metadata = await stat(join(root, stored.storageKey));

    expect(metadata.mode & 0o777).toBe(0o600);
  });

  it('removes an orphan when asked to delete a stored object', async () => {
    const { root, store } = await fixture();

    const stored = await store.put({
      organizationId: '11111111-1111-4111-8111-111111111111',

      documentId: '22222222-2222-4222-8222-222222222222',

      bytes: new Uint8Array([4, 5, 6]),
    });

    await store.delete(stored.storageKey);

    await expect(readFile(join(root, stored.storageKey))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects unsafe storage path segments', async () => {
    const { store } = await fixture();

    await expect(
      store.put({
        organizationId: '../outside',

        documentId: '22222222-2222-4222-8222-222222222222',

        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow('private_storage.invalid_segment');
  });
});
