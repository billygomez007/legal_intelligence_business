import { randomUUID } from 'node:crypto';

import { mkdir, unlink, writeFile } from 'node:fs/promises';

import { dirname, resolve, sep } from 'node:path';

import type {
  PrivateFileStore,
  PutPrivateFileInput,
  StoredPrivateFile,
} from './private-file-store.js';

const SAFE_SEGMENT = /^[A-Za-z0-9-]+$/u;

function safeSegment(value: string): string {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error('private_storage.invalid_segment');
  }

  return value;
}

export function createLocalPrivateFileStore(rootDirectory: string): PrivateFileStore {
  const root = resolve(rootDirectory);

  function absolutePath(storageKey: string): string {
    const path = resolve(root, storageKey);

    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      throw new Error('private_storage.invalid_key');
    }

    return path;
  }

  return Object.freeze({
    async put(input: PutPrivateFileInput): Promise<StoredPrivateFile> {
      const organizationId = safeSegment(input.organizationId);

      const documentId = safeSegment(input.documentId);

      const storageKey = [organizationId, documentId, randomUUID()].join('/');

      const path = absolutePath(storageKey);

      await mkdir(
        dirname(path),

        {
          recursive: true,

          mode: 0o700,
        },
      );

      await writeFile(
        path,
        input.bytes,

        {
          flag: 'wx',

          mode: 0o600,
        },
      );

      return {
        storageKey,
      };
    },

    async delete(storageKey: string): Promise<void> {
      const path = absolutePath(storageKey);

      try {
        await unlink(path);
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return;
        }

        throw error;
      }
    },
  });
}
