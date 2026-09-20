'use client';
import { useState } from 'react';
import type { Alert, LegalAuthority, ResearchProject } from '../data/types';
import { AuthorityCard } from './legal';
import { Button, EmptyState } from './ui/primitives';
import { routes } from '../lib/routes';
export function DemoNotes({ initialNote }: { initialNote: string }) {
  const [note, setNote] = useState(initialNote);
  return (
    <section className="note-editor" aria-label="User note">
      <p className="eyebrow">User note · local preview</p>
      <label className="field">
        Research notes
        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
          placeholder="Write an example note…"
          maxLength={5000}
        />
      </label>
      <p className="micro">
        Changes stay in this view and are lost on reload or navigation. Do not enter confidential
        information.
      </p>
    </section>
  );
}
export function LibraryView({
  authorities,
  projects,
}: {
  authorities: LegalAuthority[];
  projects: ResearchProject[];
}) {
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('title');
  const visible = authorities
    .filter((a) => kind === 'all' || a.kind === kind)
    .sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title) : b.date.localeCompare(a.date),
    );
  return (
    <>
      <div className="flex flex-wrap gap-5">
        <label className="field">
          Saved content
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
            }}
          >
            <option value="all">All authorities</option>
            <option value="case">Cases</option>
            <option value="legislation">Legislation</option>
            <option value="passages">Passages</option>
            <option value="reports">Research reports</option>
          </select>
        </label>
        <label className="field">
          Sort by
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
            }}
          >
            <option value="title">Title A–Z</option>
            <option value="date">Authority date, newest first</option>
          </select>
        </label>
      </div>
      {kind === 'passages' ? (
        <div className="panel panel-padded">
          <h2>Saved passages</h2>
          <p className="micro my-3">
            Open the example matter to inspect its saved source passages.
          </p>
          {projects
            .filter((p) => p.passageIds.length)
            .map((p) => (
              <p key={p.id}>
                <a className="text-link" href={routes.researchProject(p.id)}>
                  {p.title} · {p.passageIds.length} passages
                </a>
              </p>
            ))}
        </div>
      ) : kind === 'reports' ? (
        <EmptyState
          title="No research reports yet"
          description="Report generation and export will be connected in a later stage."
        />
      ) : (
        <div className="panel">
          {visible.length ? (
            visible.map((a) => <AuthorityCard key={a.id} authority={a} />)
          ) : (
            <EmptyState />
          )}
        </div>
      )}
    </>
  );
}
export function AlertManager({ initialAlerts }: { initialAlerts: Alert[] }) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [notice, setNotice] = useState('');
  return (
    <>
      <div className="notice mb-5">
        <div>
          <strong>Notification preview only</strong>
          <p>
            Toggle example statuses to explore the interface. Nothing is saved and no notifications
            are sent.
          </p>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Demonstration alerts</caption>
          <thead>
            <tr>
              <th scope="col">Alert name</th>
              <th scope="col">Type</th>
              <th scope="col">Frequency</th>
              <th scope="col">Status · demo</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.id}>
                <td>{alert.name}</td>
                <td>{alert.type}</td>
                <td>{alert.frequency}</td>
                <td>{alert.status}</td>
                <td>
                  <Button
                    className="secondary"
                    aria-label={`${alert.status === 'Active' ? 'Pause' : 'Activate'} ${alert.name}`}
                    onClick={() => {
                      setAlerts((items) =>
                        items.map((item) =>
                          item.id === alert.id
                            ? { ...item, status: item.status === 'Active' ? 'Paused' : 'Active' }
                            : item,
                        ),
                      );
                      setNotice(
                        'Example status updated in this view only. No notification service is connected.',
                      );
                    }}
                  >
                    {alert.status === 'Active' ? 'Pause' : 'Activate'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p role="status" className="micro mt-4">
        {notice}
      </p>
    </>
  );
}
export function SettingsForm() {
  const [saved, setSaved] = useState(false);
  const [density, setDensity] = useState('comfortable');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(true);
      }}
    >
      <div className="settings-grid">
        <section className="panel panel-padded">
          <h2>Profile</h2>
          <label className="field">
            Display name
            <input defaultValue="Example researcher" maxLength={100} />
          </label>
          <label className="field">
            Email address
            <input type="email" defaultValue="researcher@example.invalid" maxLength={200} />
          </label>
          <p className="micro">Demonstration profile. No account or authentication exists.</p>
        </section>
        <section className="panel panel-padded">
          <h2>Appearance</h2>
          <label className="field">
            Reading preview
            <select
              value={density}
              onChange={(e) => {
                setDensity(e.target.value);
              }}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <div style={{ padding: density === 'compact' ? '8px' : '22px' }} className="panel">
            <p className="micro">Example source reading density</p>
          </div>
          <p className="micro mt-3">Light workspace · High contrast navigation</p>
        </section>
        <section className="panel panel-padded">
          <h2>Notifications</h2>
          <label className="check-field">
            <input type="checkbox" defaultChecked />
            Example weekly research digest
          </label>
          <label className="check-field">
            <input type="checkbox" />
            Example authority updates
          </label>
          <p className="micro">Delivery is not connected.</p>
        </section>
        <section className="panel panel-padded">
          <h2>Organization & security</h2>
          <p className="micro mb-3">
            Example workspace. Access controls, session management and multi-factor authentication
            will be connected to the platform identity service.
          </p>
          <a className="text-link" href={routes.organization}>
            Open organization preview
          </a>
        </section>
      </div>
      <Button className="mt-5" type="submit">
        Preview preferences
      </Button>
      <p role="status" className="micro mt-3">
        {saved
          ? 'Preferences previewed in this view only. Nothing was saved.'
          : 'Changes are temporary and are lost when you leave this view.'}
      </p>
    </form>
  );
}
