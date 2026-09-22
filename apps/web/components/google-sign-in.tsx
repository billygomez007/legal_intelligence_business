'use client';

import { useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize(options: {
            client_id: string;
            callback(response: { credential?: string }): void;
          }): void;

          renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
        };
      };
    };
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

export function GoogleSignIn() {
  const router = useRouter();

  const buttonRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'working' | 'error'>('loading');

  const [error, setError] = useState('');

  useEffect(() => {
    if (CLIENT_ID.length === 0) {
      setStatus('error');

      setError('Google sign-in is not configured.');

      return;
    }

    const script = document.createElement('script');

    script.src = 'https://accounts.google.com/gsi/client';

    script.async = true;

    script.defer = true;

    script.onload = () => {
      const google = window.google?.accounts?.id;

      if (!google || !buttonRef.current) {
        setStatus('error');

        setError('Google Identity Services could not be loaded.');

        return;
      }

      google.initialize({
        client_id: CLIENT_ID,

        callback: (response) => {
          const credential = response.credential;

          if (typeof credential !== 'string' || credential.length === 0) {
            setStatus('error');

            setError('Google did not return an identity credential.');

            return;
          }

          setStatus('working');

          setError('');

          void fetch('/api/auth/google', {
            method: 'POST',

            headers: {
              'content-type': 'application/json',
            },

            body: JSON.stringify({
              credential,
            }),
          })
            .then(async (result) => {
              const body = await result.json();

              if (!result.ok || body?.data?.authenticated !== true) {
                throw new Error('authentication_failed');
              }

              router.replace('/dashboard');

              router.refresh();
            })
            .catch(() => {
              setStatus('error');

              setError('We could not complete your Law Afrique sign-in.');
            });
        },
      });

      google.renderButton(buttonRef.current, {
        type: 'standard',

        theme: 'outline',

        size: 'large',

        shape: 'pill',

        text: 'signin_with',

        width: 320,
      });

      setStatus('ready');
    };

    script.onerror = () => {
      setStatus('error');

      setError('Google Identity Services could not be loaded.');
    };

    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [router]);

  return (
    <div>
      <div ref={buttonRef} />

      {status === 'loading' && <p>Loading secure sign-in…</p>}

      {status === 'working' && <p>Verifying your identity…</p>}

      {status === 'error' && (
        <p
          style={{
            color: '#ffaaaa',
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
