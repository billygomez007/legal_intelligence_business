import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import {
  checksumSchema,
  IngestionFailure,
  MAX_BYTES,
  requestSchema,
  type IngestionRequest,
} from '../domain/model';
import type { ArtifactStorage, SourceAcquirer } from '../ports/pipeline';

export const hash = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

async function checkedRoot(root: string, create: boolean): Promise<string> {
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new IngestionFailure('storage_failed');
  // Also reject symlinked ancestors. Provision using realpath() on macOS's /tmp alias.
  if ((await realpath(root)) !== resolve(root)) throw new IngestionFailure('storage_failed');
  return root;
}

async function readBounded(path: string): Promise<Uint8Array> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size === 0 || info.size > MAX_BYTES)
      throw new IngestionFailure('input_invalid');
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length !== info.size) throw new IngestionFailure('integrity_failed');
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}

/** Development adapter. Root belongs exclusively to the service account; never serve it via HTTP. */
export class LocalArtifactStorage implements ArtifactStorage {
  constructor(private readonly root: string) {}
  async put(sourceId: string, checksum: string, bytes: Uint8Array): Promise<string> {
    if (
      !z.uuid().safeParse(sourceId).success ||
      !checksumSchema.safeParse(checksum).success ||
      bytes.length === 0 ||
      bytes.length > MAX_BYTES
    )
      throw new IngestionFailure('input_invalid');
    if (hash(bytes) !== checksum) throw new IngestionFailure('integrity_failed');
    const key = `corpus-${sourceId}-${checksum}`;
    try {
      await checkedRoot(this.root, true);
      const path = join(this.root, key);
      const temporary = join(this.root, `.write-${randomUUID()}`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        try {
          await link(temporary, path);
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
        }
      } finally {
        await unlink(temporary);
      }
      // Verify an existing object too: conflicts are never overwritten.
      await this.get(sourceId, key, checksum);
      return key;
    } catch (error) {
      if (error instanceof IngestionFailure) throw error;
      throw new IngestionFailure('storage_failed');
    }
  }
  async get(sourceId: string, key: string, checksum: string): Promise<Uint8Array> {
    if (
      !z.uuid().safeParse(sourceId).success ||
      !checksumSchema.safeParse(checksum).success ||
      key !== `corpus-${sourceId}-${checksum}`
    )
      throw new IngestionFailure('input_invalid');
    try {
      await checkedRoot(this.root, false);
      const bytes = await readBounded(join(this.root, key));
      if (hash(bytes) !== checksum) throw new IngestionFailure('integrity_failed');
      return bytes;
    } catch (error) {
      if (error instanceof IngestionFailure) throw error;
      throw new IngestionFailure('storage_failed');
    }
  }
}

/** Files are provisioned out of band by a rights-authorized operator, never uploaded tenant keys. */
export class LocalInboxAcquirer implements SourceAcquirer {
  constructor(private readonly root: string) {}
  async acquire(request: IngestionRequest): Promise<Uint8Array> {
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success) throw new IngestionFailure('input_invalid');
    try {
      await checkedRoot(this.root, false);
      return await readBounded(join(this.root, `${request.sourceId}-${request.inputReference}`));
    } catch (error) {
      if (error instanceof IngestionFailure) throw error;
      throw new IngestionFailure('acquisition_failed');
    }
  }
}
