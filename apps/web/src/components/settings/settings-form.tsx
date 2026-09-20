'use client';

import Link from 'next/link';
import { useState } from 'react';
import { routes } from '../../lib/routes';
import type { UserProfile } from '../../data/types';
import { Button } from '../ui/primitives';

const sections = [
  { id: 'profile', label: 'Profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'organization', label: 'Organization' },
  { id: 'security', label: 'Security' },
] as const;

/** Preference controls with local state only. Nothing is persisted. */
export function SettingsForm({ profile }: { profile: UserProfile }) {
  const [saved, setSaved] = useState(false);
  const [density, setDensity] = useState('comfortable');
  return (
    <form
      className="settings-layout"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(true);
      }}
    >
      <nav className="settings-nav" aria-label="Settings sections">
        <ul>
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="settings-sections">
        <section className="panel panel-padded settings-section" id="profile">
          <h2>Profile</h2>
          <label className="field">
            Display name
            <input defaultValue={profile.name} maxLength={100} />
          </label>
          <label className="field">
            Email address
            <input type="email" defaultValue={profile.email} maxLength={200} />
          </label>
          <p className="micro">Demonstration profile. No account or authentication exists.</p>
        </section>
        <section className="panel panel-padded settings-section" id="appearance">
          <h2>Appearance</h2>
          <div className="theme-choices" role="group" aria-label="Theme">
            <button type="button" className="theme-choice" aria-pressed="true">
              <span className="theme-swatch navy" aria-hidden="true" />
              Navy and gold
              <span className="micro">Current</span>
            </button>
            <button type="button" className="theme-choice" disabled>
              <span className="theme-swatch light" aria-hidden="true" />
              Light
              <span className="micro">Not available</span>
            </button>
          </div>
          <label className="field">
            Reading density
            <select
              value={density}
              onChange={(event) => {
                setDensity(event.target.value);
              }}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <div className={`density-preview ${density}`}>
            <p className="micro">Example source reading density</p>
            <p>Sample passage text shown at the selected density.</p>
          </div>
        </section>
        <section className="panel panel-padded settings-section" id="notifications">
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
        <section className="panel panel-padded settings-section" id="organization">
          <h2>Organization</h2>
          <p className="muted">
            {profile.organisationType} · Example workspace. Membership, roles and workspaces are
            managed on the organization page.
          </p>
          <Link className="text-link" href={routes.organization}>
            Open organization preview
          </Link>
        </section>
        <section className="panel panel-padded settings-section" id="security">
          <h2>Security</h2>
          <p className="muted">
            Sign-in, session management and multi-factor authentication will be provided by the
            platform identity service. None of them exists in this demonstration.
          </p>
        </section>
        <div className="settings-actions">
          <Button type="submit">Preview preferences</Button>
          <p role="status" className="micro">
            {saved
              ? 'Preferences previewed in this view only. Nothing was saved.'
              : 'Changes are temporary and are lost when you leave this view.'}
          </p>
        </div>
      </div>
    </form>
  );
}
