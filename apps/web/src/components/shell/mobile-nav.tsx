'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import type { UserProfile } from '../../data/types';
import { Sidebar } from './sidebar';

/** Below the desktop breakpoint the sidebar is a modal drawer: focus-trapped, Escape to close. */
export function MobileNav({ profile }: { profile: UserProfile }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="icon-button mobile-menu" aria-label="Open navigation">
        <Menu size={20} aria-hidden="true" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="mobile-drawer">
          <Dialog.Title className="sr-only">Workspace navigation</Dialog.Title>
          <Dialog.Description className="sr-only">
            Navigate the LexGhana demonstration workspace.
          </Dialog.Description>
          <Sidebar
            profile={profile}
            onNavigate={() => {
              setOpen(false);
            }}
          />
          <Dialog.Close className="dialog-close" aria-label="Close navigation">
            <X size={20} aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
