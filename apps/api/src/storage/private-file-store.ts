export interface PutPrivateFileInput {
  readonly organizationId: string;

  readonly documentId: string;

  readonly bytes: Uint8Array;
}

export interface StoredPrivateFile {
  readonly storageKey: string;
}

export interface PrivateFileStore {
  put(input: PutPrivateFileInput): Promise<StoredPrivateFile>;

  delete(storageKey: string): Promise<void>;
}
