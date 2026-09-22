'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();

  const [working, setWorking] = useState(false);

  return (
    <button
      type="button"
      className="workspace-sign-out"
      disabled={working}
      onClick={() => {
        setWorking(true);

        void fetch('/api/auth/sign-out', {
          method: 'POST',
        }).finally(() => {
          router.replace('/sign-in');

          router.refresh();
        });
      }}
    >
      <span>{working ? 'Signing out…' : 'Sign out'}</span>

      <span aria-hidden="true">→</span>
    </button>
  );
}
