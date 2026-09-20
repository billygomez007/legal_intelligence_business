'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Bell,
  BookMarked,
  Building2,
  ChevronDown,
  FolderOpen,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Scale,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { DemoBadge } from './legal';
const navigation = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/ask', label: 'Ask the Law', icon: MessageSquareText },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/research', label: 'Research', icon: FolderOpen },
  { href: '/library', label: 'Library', icon: BookMarked },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/organization', label: 'Organization', icon: Building2 },
  { href: '/settings', label: 'Settings', icon: Settings },
];
export function MainNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main navigation">
      {navigation.map(({ href, label, icon: Icon }, index) => (
        <Link
          onClick={() => {
            onNavigate?.();
          }}
          key={href}
          href={href}
          className={`nav-item ${index === 6 ? 'secondary-start' : ''}`}
          aria-current={(href === '/' ? path === '/' : path.startsWith(href)) ? 'page' : undefined}
        >
          <Icon size={18} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-symbol">
        <Scale size={24} aria-hidden="true" />
      </span>
      <span>
        Legal Intelligence<small>GHANA · RESEARCH WORKSPACE</small>
      </span>
    </Link>
  );
}
export function CommandSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, []);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="command-trigger">
        <Search size={16} aria-hidden="true" />
        <span>Find a page or search</span>
        <kbd>⌘ K</kbd>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>Search your workspace</Dialog.Title>
          <Dialog.Description>
            Jump to a page or search the demonstration corpus.
          </Dialog.Description>
          <label className="field">
            Search pages
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              placeholder="Search pages or authorities…"
            />
          </label>
          <ul className="command-list">
            {navigation
              .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
              .map((item) => (
                <li key={item.href}>
                  <Link
                    onClick={() => {
                      setOpen(false);
                    }}
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
          </ul>
          <Link
            className="text-link"
            onClick={() => {
              setOpen(false);
            }}
            href={`/search?q=${encodeURIComponent(query)}`}
          >
            Search demonstration authorities
          </Link>
          <Dialog.Close className="dialog-close" aria-label="Close command search">
            <X size={20} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="workspace-selector">
          <span className="workspace-avatar">EW</span>
          <div>
            Example workspace<small>Professional preview</small>
          </div>
          <ChevronDown size={14} aria-hidden="true" />
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <MainNavigation />
        <div className="sidebar-bottom">
          <div className="preview-note">
            <ShieldIcon />A source-first workspace<p>Every authority has a provenance trail.</p>
          </div>
          <Link className="profile" href="/settings">
            <span className="workspace-avatar">ER</span>
            <span>
              Example researcher<small>Demonstration profile</small>
            </span>
            <Settings size={16} aria-hidden="true" />
          </Link>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Dialog.Trigger className="mobile-menu icon-button" aria-label="Open navigation">
              <Menu size={22} />
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content className="mobile-drawer">
                <Dialog.Title>Workspace navigation</Dialog.Title>
                <Dialog.Description className="sr-only">
                  Navigate the demonstration application
                </Dialog.Description>
                <MainNavigation
                  onNavigate={() => {
                    setMenuOpen(false);
                  }}
                />
                <Dialog.Close className="dialog-close" aria-label="Close navigation">
                  <X size={20} />
                </Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <div className="topbar-context">
            Workspace <span>/</span> Ghana
          </div>
          <CommandSearch />
          <Link href="/alerts" className="icon-button" aria-label="Manage alerts">
            <Bell size={18} />
          </Link>
        </header>
        <div className="demo-banner">
          <DemoBadge />
          <span>
            Synthetic authorities only. No live legal research, authentication or saved data.
          </span>
        </div>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="app-footer">
          <span>Legal Intelligence · Ghana</span>
          <span>Research foundation · Demonstration only</span>
        </footer>
      </div>
    </div>
  );
}
function ShieldIcon() {
  return <BookMarked size={17} aria-hidden="true" />;
}
