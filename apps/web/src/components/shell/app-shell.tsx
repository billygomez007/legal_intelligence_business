import type { ReactNode } from 'react';
import type { UserProfile } from '../../data/types';
import { DemoBadge } from '../legal';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

/**
 * The authenticated application frame: fixed sidebar (desktop), compact top bar, a persistent
 * demonstration notice, and the page content. Public marketing pages do not use this shell.
 */
export function AppShell({ children, profile }: { children: ReactNode; profile: UserProfile }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Sidebar profile={profile} />
      </aside>
      <div className="app-main">
        <TopBar profile={profile} />
        <div className="demo-strip">
          <DemoBadge />
          <span>Synthetic records only. No live legal research, authentication or saved data.</span>
        </div>
        <main id="main-content" tabIndex={-1} className="app-content">
          {children}
        </main>
        <footer className="app-footer">
          <span>LexGhana · Legal Intelligence</span>
          <span>Demonstration environment · Synthetic data only</span>
        </footer>
      </div>
    </div>
  );
}
