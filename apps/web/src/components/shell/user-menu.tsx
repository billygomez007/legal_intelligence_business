'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { routes } from '../../lib/routes';
import type { UserProfile } from '../../data/types';

/**
 * Account disclosure. Follows the disclosure-navigation pattern: a button that toggles a list of
 * links, closes on Escape (returning focus to the button), on outside click and on focus leaving.
 */
export function UserMenu({
  profile,
  onNavigate,
}: {
  profile: UserProfile;
  onNavigate: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onOutside = (event: Event) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('focusin', onOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('focusin', onOutside);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    onNavigate?.();
  };

  return (
    <div className="user-menu" ref={container}>
      <button
        ref={button}
        type="button"
        className="user-card"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span className="avatar" aria-hidden="true">
          {profile.initials}
        </span>
        <span className="user-meta">
          <span className="user-name">{profile.name}</span>
          <span className="user-org">{profile.organisationType}</span>
        </span>
        <ChevronDown className="user-chevron" size={16} aria-hidden="true" />
      </button>
      {open && (
        <ul id={menuId} className="user-popover" aria-label="Account">
          <li>
            <Link href={routes.settings} onClick={close}>
              Profile and settings
            </Link>
          </li>
          <li>
            <Link href={routes.organization} onClick={close}>
              Organization
            </Link>
          </li>
          <li>
            <Link href={routes.home} onClick={close}>
              LexGhana website
            </Link>
          </li>
          <li className="user-popover-note">
            Sign-out is unavailable: this demonstration has no accounts.
          </li>
        </ul>
      )}
    </div>
  );
}
