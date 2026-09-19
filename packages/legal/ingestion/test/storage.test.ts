import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  hash,
  IngestionFailure,
  LocalArtifactStorage,
  LocalInboxAcquirer,
  MAX_BYTES,
} from '../src';
import { requestFor } from './support';

let base: string;
beforeAll(() => {
  // realpath: macOS aliases /tmp, and the adapter refuses a root reached through a symlink.
  base = mkdtempSync(join(realpathSync(tmpdir()), 'ingestion-storage-'));
});
afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const freshDir = (mode = 0o700) => {
  const dir = mkdtempSync(join(base, 'root-'));
  chmodSync(dir, mode);
  return dir;
};
const category = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(IngestionFailure);
    return (error as IngestionFailure).category;
  }
  return 'no failure';
};

const CONTENT = new TextEncoder().encode('SYNTHETIC raw artifact bytes, preserved exactly.\n');

describe('local artifact storage', () => {
  it('stores the original bytes under a key derived from source and checksum, never a URL', async () => {
    const root = freshDir();
    const storage = new LocalArtifactStorage(root);
    const source = randomUUID();
    const key = await storage.put(source, hash(CONTENT), CONTENT);
    expect(key).toBe(`corpus-${source}-${hash(CONTENT)}`);
    expect(key).not.toMatch(/[:/]/);
    expect(Buffer.from(await storage.get(source, key, hash(CONTENT)))).toEqual(
      Buffer.from(CONTENT),
    );
    expect(readFileSync(join(root, key))).toEqual(Buffer.from(CONTENT));
  });

  it('is idempotent and leaves no temporary files behind', async () => {
    const root = freshDir();
    const storage = new LocalArtifactStorage(root);
    const source = randomUUID();
    const first = await storage.put(source, hash(CONTENT), CONTENT);
    const second = await storage.put(source, hash(CONTENT), CONTENT);
    expect(second).toBe(first);
    expect(readdirSync(root)).toEqual([first]);
  });

  it('keeps sources apart: the same bytes under another source is a different object', async () => {
    const root = freshDir();
    const storage = new LocalArtifactStorage(root);
    const a = await storage.put(randomUUID(), hash(CONTENT), CONTENT);
    const b = await storage.put(randomUUID(), hash(CONTENT), CONTENT);
    expect(a).not.toBe(b);
    expect(readdirSync(root)).toHaveLength(2);
  });

  it('refuses bytes that do not match the checksum they were offered under', async () => {
    const storage = new LocalArtifactStorage(freshDir());
    expect(
      await category(storage.put(randomUUID(), hash(CONTENT), new Uint8Array([1, 2, 3]))),
    ).toBe('integrity_failed');
  });

  it('never overwrites an existing object and reports a corrupted one', async () => {
    const root = freshDir();
    const storage = new LocalArtifactStorage(root);
    const source = randomUUID();
    const key = await storage.put(source, hash(CONTENT), CONTENT);
    writeFileSync(join(root, key), 'tampered on disk');
    expect(await category(storage.put(source, hash(CONTENT), CONTENT))).toBe('integrity_failed');
    expect(readFileSync(join(root, key), 'utf8')).toBe('tampered on disk');
    expect(await category(storage.get(source, key, hash(CONTENT)))).toBe('integrity_failed');
  });

  it('refuses keys that are not exactly the derived key (path traversal and friends)', async () => {
    const root = freshDir();
    const storage = new LocalArtifactStorage(root);
    const source = randomUUID();
    const checksum = hash(CONTENT);
    for (const key of [
      `../corpus-${source}-${checksum}`,
      `/etc/passwd`,
      `corpus-${source}-${checksum}/../../x`,
      `corpus-${randomUUID()}-${checksum}`,
      `corpus-${source}-${'0'.repeat(64)}`,
      '',
    ]) {
      expect(await category(storage.get(source, key, checksum))).toBe('input_invalid');
    }
    expect(await category(storage.get('../../etc', `corpus-x-${checksum}`, checksum))).toBe(
      'input_invalid',
    );
  });

  it('refuses empty and oversized objects', async () => {
    const storage = new LocalArtifactStorage(freshDir());
    expect(
      await category(storage.put(randomUUID(), hash(new Uint8Array(0)), new Uint8Array(0))),
    ).toBe('input_invalid');
    const big = new Uint8Array(MAX_BYTES + 1);
    expect(await category(storage.put(randomUUID(), hash(big), big))).toBe('input_invalid');
  });

  it('does not follow a symbolic link planted at the object path', async () => {
    const root = freshDir();
    const outside = join(base, `outside-${randomUUID()}`);
    writeFileSync(outside, CONTENT);
    const source = randomUUID();
    const key = `corpus-${source}-${hash(CONTENT)}`;
    symlinkSync(outside, join(root, key));
    const storage = new LocalArtifactStorage(root);
    expect(await category(storage.get(source, key, hash(CONTENT)))).toBe('storage_failed');
    // A write must not "succeed" by trusting what the link points at.
    expect(await category(storage.put(source, hash(CONTENT), CONTENT))).toBe('storage_failed');
  });

  it('refuses a root that other users could read, or that is itself a link', async () => {
    const open = freshDir(0o755);
    expect(
      await category(new LocalArtifactStorage(open).put(randomUUID(), hash(CONTENT), CONTENT)),
    ).toBe('storage_failed');
    const real = freshDir();
    const link = join(base, `link-${randomUUID()}`);
    symlinkSync(real, link);
    expect(
      await category(new LocalArtifactStorage(link).put(randomUUID(), hash(CONTENT), CONTENT)),
    ).toBe('storage_failed');
  });

  it('refuses a named pipe or other non-regular file without blocking on it', async () => {
    const root = freshDir();
    const source = randomUUID();
    const key = `corpus-${source}-${hash(CONTENT)}`;
    try {
      execFileSync('mkfifo', [join(root, key)]);
    } catch {
      return; // mkfifo unavailable on this host; the regular-file check is covered above.
    }
    expect(await category(new LocalArtifactStorage(root).get(source, key, hash(CONTENT)))).toBe(
      'input_invalid',
    );
  });
});

describe('local inbox acquirer', () => {
  const provision = (root: string, request: ReturnType<typeof requestFor>, bytes: Uint8Array) => {
    writeFileSync(join(root, `${request.sourceId}-${request.inputReference}`), bytes, {
      mode: 0o600,
    });
  };

  it('reads only the object provisioned for that exact source and reference', async () => {
    const root = freshDir();
    const request = requestFor(CONTENT);
    provision(root, request, CONTENT);
    expect(Buffer.from(await new LocalInboxAcquirer(root).acquire(request))).toEqual(
      Buffer.from(CONTENT),
    );
  });

  it('reports a missing object as a retryable acquisition failure', async () => {
    const acquirer = new LocalInboxAcquirer(freshDir());
    expect(await category(acquirer.acquire(requestFor(CONTENT)))).toBe('acquisition_failed');
  });

  it('cannot be steered outside its root by request fields', async () => {
    const root = freshDir();
    const acquirer = new LocalInboxAcquirer(root);
    const request = requestFor(CONTENT);
    const hostile = { ...request, inputReference: '../../etc/passwd' };
    expect(await category(acquirer.acquire(hostile))).toBe('input_invalid');
  });

  it('does not follow a link placed in the inbox', async () => {
    const root = freshDir();
    const request = requestFor(CONTENT);
    const outside = join(base, `secret-${randomUUID()}`);
    writeFileSync(outside, 'not a legal document');
    symlinkSync(outside, join(root, `${request.sourceId}-${request.inputReference}`));
    expect(await category(new LocalInboxAcquirer(root).acquire(request))).toBe(
      'acquisition_failed',
    );
  });

  it('refuses an empty or oversized file', async () => {
    const root = freshDir();
    const empty = requestFor('x');
    provision(root, empty, new Uint8Array(0));
    expect(await category(new LocalInboxAcquirer(root).acquire(empty))).toBe('input_invalid');
    const big = requestFor('y');
    provision(root, big, new Uint8Array(MAX_BYTES + 1));
    expect(await category(new LocalInboxAcquirer(root).acquire(big))).toBe('input_invalid');
  });

  it('creates nothing when the inbox does not exist', async () => {
    const missing = join(base, `absent-${randomUUID()}`);
    mkdirSync(join(base, 'placeholder'), { recursive: true });
    expect(await category(new LocalInboxAcquirer(missing).acquire(requestFor(CONTENT)))).toBe(
      'acquisition_failed',
    );
    expect(readdirSync(base)).not.toContain(missing.split('/').pop());
  });
});
