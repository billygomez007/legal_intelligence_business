'use client';

import Link from 'next/link';
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { navLinks } from '../../content/marketing';
import { routes } from '../../lib/routes';
import { BrandMark } from '../brand/brand-mark';

/** Public navigation. Links scroll to sections of the homepage; below 64rem they live in a dialog. */
export function MarketingNavbar() {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  return (
    <header className="m-navbar">
      <div className="m-container m-navbar-inner">
        <BrandMark href={routes.home} />
        <nav aria-label="Primary" className="m-nav">
          <ul>
            {navLinks.map((link) => (
              <li key={link.label}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="m-nav-actions">
          <Link className="button ghost" href={routes.signIn}>
            Sign in
          </Link>
          <Link className="button" href={routes.getStarted}>
            Get started
          </Link>
        </div>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger className="icon-button m-menu-button" aria-label="Open menu">
            <Menu size={20} aria-hidden="true" />
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="m-drawer">
              <Dialog.Title className="sr-only">LexGhana menu</Dialog.Title>
              <Dialog.Description className="sr-only">
                Site sections and account links.
              </Dialog.Description>
              <BrandMark />
              <nav aria-label="Mobile">
                <ul className="m-drawer-links">
                  {navLinks.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} onClick={close}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="m-drawer-actions">
                <Link className="button secondary" href={routes.signIn} onClick={close}>
                  Sign in
                </Link>
                <Link className="button" href={routes.getStarted} onClick={close}>
                  Get started
                </Link>
              </div>
              <Dialog.Close className="dialog-close" aria-label="Close menu">
                <X size={20} aria-hidden="true" />
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </header>
  );
}
