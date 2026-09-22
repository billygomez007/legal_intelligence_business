'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

export function OrganizationOnboardingForm() {
  const router = useRouter();

  const [name, setName] = useState('');

  const [kind, setKind] = useState('firm');

  const [working, setWorking] = useState(false);

  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="organization-onboarding-form"
      onSubmit={async (event) => {
        event.preventDefault();

        setWorking(true);

        setError(null);

        const response = await fetch(
          '/api/organization',

          {
            method: 'POST',

            headers: {
              'content-type': 'application/json',
            },

            body: JSON.stringify({
              name: name.trim(),

              kind,
            }),
          },
        );

        const body = await response.json().catch(() => null);

        if (!response.ok) {
          setError(body?.error?.code ?? 'Unable to create organization.');

          setWorking(false);

          return;
        }

        router.push('/dashboard');

        router.refresh();
      }}
    >
      <div className="organization-onboarding-field">
        <label htmlFor="organization-name">Organization name</label>

        <input
          id="organization-name"
          name="organizationName"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Gomez Legal"
          minLength={2}
          maxLength={200}
          required
          autoFocus
        />
      </div>

      <div className="organization-onboarding-field">
        <label htmlFor="organization-kind">Workspace type</label>

        <select
          id="organization-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="firm">Law firm</option>

          <option value="individual">Individual practitioner</option>

          <option value="corporate">Corporate legal team</option>

          <option value="institution">Institution</option>
        </select>
      </div>

      {error !== null && <div className="workspace-error">{error}</div>}

      <button
        type="submit"
        className="button-primary organization-onboarding-submit"
        disabled={working || name.trim().length < 2}
      >
        {working ? 'Creating workspace…' : 'Create organization'}
      </button>

      <p className="organization-onboarding-note">You will become the owner of this workspace.</p>
    </form>
  );
}
