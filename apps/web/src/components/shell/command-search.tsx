'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Search, X } from 'lucide-react';
import { routes } from '../../lib/routes';
import { allNavigation } from './navigation';

/** Global search: a field-shaped trigger, opened with ⌘K / Ctrl+K, that searches or jumps to a page. */
export function CommandSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const pages = allNavigation.filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="command-trigger" aria-keyshortcuts="Control+K Meta+K">
        <Search size={18} aria-hidden="true" />
        <span className="command-trigger-label">Search LexGhana…</span>
        <kbd aria-hidden="true">⌘ K</kbd>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>Search LexGhana</Dialog.Title>
          <Dialog.Description className="muted">
            Search the demonstration authorities, or jump to a page.
          </Dialog.Description>
          <form action={routes.search} method="get" className="field">
            <label htmlFor="command-query">Search pages or authorities</label>
            <input
              id="command-query"
              name="q"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search authorities, or type a page name…"
              autoComplete="off"
            />
            <button type="submit" className="button">
              Search authorities
            </button>
          </form>
          <ul className="command-list" aria-label="Pages">
            {pages.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  <item.icon size={16} aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <Dialog.Close className="dialog-close" aria-label="Close command search">
            <X size={20} aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
