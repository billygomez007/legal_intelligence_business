import { FileText, Plus, Upload } from 'lucide-react';
import { notFound } from 'next/navigation';

import { getMatterWorkspace } from '../../../../../data/matter-workspace';

export default async function MatterDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = getMatterWorkspace(id);

  if (!matter) {
    notFound();
  }

  return (
    <>
      <section className="matter-section-header">
        <div>
          <p className="eyebrow">MATTER FILES</p>
          <h2>Documents</h2>
          <p className="muted">
            Organize pleadings, correspondence, evidence and internal work product.
          </p>
        </div>

        <div className="flex gap-4">
          <button className="button secondary" type="button" disabled>
            <Upload size={15} aria-hidden="true" />
            Upload
          </button>

          <button className="button" type="button" disabled>
            <Plus size={15} aria-hidden="true" />
            New document
          </button>
        </div>
      </section>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Category</th>
              <th>Version</th>
              <th>Updated</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {matter.documents.map((document) => (
              <tr key={document.id}>
                <td>
                  <span className="matter-table-title">
                    <FileText size={15} aria-hidden="true" />
                    {document.name}
                  </span>
                </td>
                <td>{document.category}</td>
                <td>{document.version}</td>
                <td>{document.updated}</td>
                <td>
                  <span className="demo-badge">{document.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="micro mt-4">
        Demonstration documents only. Private document ingestion is not connected to this
        public-corpus preview.
      </p>
    </>
  );
}
