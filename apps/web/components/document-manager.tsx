'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

interface Matter {
  readonly id: string;

  readonly name: string;

  readonly reference?: string | null;
}

interface Document {
  readonly id: string;

  readonly matterId: string;

  readonly name: string;

  readonly description: string | null;

  readonly status: string;

  readonly versionCount: number;

  readonly latestVersionNumber: number | null;
}

export function DocumentManager({
  documents,
  matters,
}: {
  readonly documents: readonly Document[];

  readonly matters: readonly Matter[];
}) {
  const router = useRouter();

  const [matterId, setMatterId] = useState(matters[0]?.id ?? '');

  const [name, setName] = useState('');

  const [description, setDescription] = useState('');

  const [working, setWorking] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [uploadingDocumentId, setUploadingDocumentId] = useState<string | null>(null);

  async function createDocument() {
    setWorking(true);

    setError(null);

    const response = await fetch(
      '/api/workspace?resource=documents',

      {
        method: 'POST',

        headers: {
          'content-type': 'application/json',
        },

        body: JSON.stringify({
          matterId,
          name: name.trim(),

          description: description.trim(),
        }),
      },
    );

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setError(body?.error?.code ?? 'Unable to create document.');

      setWorking(false);

      return;
    }

    setName('');

    setDescription('');

    setWorking(false);

    router.refresh();
  }

  async function uploadFile(documentId: string, file: File) {
    if (file.size === 0 || file.size > 20 * 1024 * 1024) {
      setError('File must be between 1 byte and 20 MB.');

      return;
    }

    setError(null);

    setUploadingDocumentId(documentId);

    const form = new FormData();

    form.set('documentId', documentId);

    form.set('file', file);

    try {
      const response = await fetch(
        '/api/document-upload',

        {
          method: 'POST',

          body: form,
        },
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(body?.error?.code ?? 'Unable to upload file.');

        return;
      }

      router.refresh();
    } finally {
      setUploadingDocumentId(null);
    }
  }

  async function archiveDocument(documentId: string) {
    setError(null);

    const response = await fetch(
      '/api/workspace?resource=documents',

      {
        method: 'PATCH',

        headers: {
          'content-type': 'application/json',
        },

        body: JSON.stringify({
          documentId,
          action: 'archive',
        }),
      },
    );

    if (!response.ok) {
      setError('Unable to archive document.');

      return;
    }

    router.refresh();
  }

  return (
    <div className="document-management-layout">
      <section className="workspace-card">
        <div className="workspace-card-heading">
          <div>
            <h2>Add document record</h2>

            <p>Attach a secure document record to a real matter.</p>
          </div>
        </div>

        {matters.length === 0 ? (
          <div className="workspace-table-empty">
            <p>A matter is required first.</p>

            <span>Create a matter before adding documents.</span>
          </div>
        ) : (
          <form
            className="workspace-form"
            onSubmit={async (event) => {
              event.preventDefault();

              await createDocument();
            }}
          >
            <label>
              <span>Matter</span>

              <select
                value={matterId}
                onChange={(event) => setMatterId(event.target.value)}
                required
              >
                {matters.map((matter) => (
                  <option key={matter.id} value={matter.id}>
                    {matter.name}
                    {matter.reference ? ` · ${matter.reference}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Document name</span>

              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Statement of Claim"
                minLength={2}
                required
              />
            </label>

            <label>
              <span>Description</span>

              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional document description"
                rows={4}
              />
            </label>

            {error !== null && <div className="workspace-error">{error}</div>}

            <button
              type="submit"
              className="button-primary"
              disabled={working || matterId.length === 0 || name.trim().length < 2}
            >
              {working ? 'Creating…' : 'Add document'}
            </button>
          </form>
        )}

        <div className="storage-boundary-note">
          <strong>File storage</strong>

          <p>
            Private file upload is enabled for local development. Uploaded files are stored outside
            the public web directory and recorded as immutable document versions with a real SHA-256
            digest, MIME type, byte size, and private storage key.
          </p>
        </div>
      </section>

      <section className="workspace-card">
        <div className="workspace-card-heading">
          <div>
            <h2>Document library</h2>

            <p>
              {documents.length} document{documents.length === 1 ? '' : 's'} in this organization.
            </p>
          </div>
        </div>

        {error !== null && <div className="workspace-error">{error}</div>}

        {documents.length === 0 ? (
          <div className="workspace-table-empty">
            <p>No documents yet.</p>

            <span>Add your first matter document record.</span>
          </div>
        ) : (
          <div className="data-table">
            <div className="data-table-row data-table-head">
              <span>Document</span>

              <span>Matter</span>

              <span>Versions</span>

              <span>Status</span>
            </div>

            {documents.map((document) => {
              const matter = matters.find((item) => item.id === document.matterId);

              return (
                <div key={document.id} className="data-table-row">
                  <div className="document-table-title">
                    <strong>{document.name}</strong>

                    <small>{document.description ?? 'No description'}</small>
                  </div>

                  <span>{matter?.name ?? 'Matter'}</span>

                  <span>
                    {document.versionCount === 0
                      ? 'No file versions'
                      : `${document.versionCount} · latest v${document.latestVersionNumber ?? document.versionCount}`}
                  </span>

                  <div className="document-table-action">
                    <span className="status-badge">{document.status}</span>

                    {document.status !== 'archived' && (
                      <>
                        <label className="file-upload-button">
                          {uploadingDocumentId === document.id ? 'Uploading…' : 'Upload file'}

                          <input
                            type="file"
                            className="file-upload-input"
                            disabled={uploadingDocumentId !== null}
                            onChange={(event) => {
                              const file = event.target.files?.[0];

                              if (file !== undefined) {
                                void uploadFile(document.id, file);
                              }

                              event.target.value = '';
                            }}
                          />
                        </label>

                        <button
                          type="button"
                          className="button-secondary compact-button"
                          disabled={uploadingDocumentId !== null}
                          onClick={() => void archiveDocument(document.id)}
                        >
                          Archive
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
