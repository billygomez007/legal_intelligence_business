import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePathname } from 'next/navigation';
import { AppShell } from '../src/components/shell/app-shell';
import {
  allNavigation,
  isActive,
  primaryNavigation,
  secondaryNavigation,
} from '../src/components/shell/navigation';
import { webClients } from '../src/data/mock-clients';

async function renderShell() {
  const { profile } = await webClients.workspace.overview();
  return render(
    <AppShell profile={profile}>
      <p>Workspace content</p>
    </AppShell>,
  );
}

const currentLinks = () =>
  screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent);

describe('LexGhana application shell', () => {
  it('carries the LexGhana brand: name, descriptor and a link to the dashboard', async () => {
    await renderShell();
    const brand = screen.getByRole('link', { name: 'LexGhana — Legal Intelligence' });
    expect(brand.getAttribute('href')).toBe('/app');
    expect(within(brand).getByText('LexGhana')).toBeDefined();
    expect(within(brand).getByText('Legal Intelligence')).toBeDefined();
  });

  it('lists primary navigation, then the secondary group, in the specified order', async () => {
    await renderShell();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Dashboard',
      'Ask the Law',
      'Search',
      'Research',
      'Library',
      'Alerts',
      'Organization',
      'Billing & Subscription',
      'Settings',
    ]);
    expect(primaryNavigation).toHaveLength(6);
    expect(secondaryNavigation.map((item) => item.label)).toEqual([
      'Organization',
      'Billing & Subscription',
      'Settings',
    ]);
  });

  it('shows the user block and the brand line', async () => {
    await renderShell();
    expect(screen.getByRole('button', { name: /Billy Gomez/ })).toBeDefined();
    expect(screen.getByText('Law Firm')).toBeDefined();
    for (const line of ['Ghanaian Law.', 'Deeper Insight.', 'Greater Impact.'])
      expect(screen.getByText(line)).toBeDefined();
  });

  it('marks the demonstration environment, provides a skip link and a main landmark', async () => {
    await renderShell();
    expect(screen.getByText('Demonstration data')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe(
      '#main-content',
    );
    expect(screen.getByRole('main').id).toBe('main-content');
  });

  it('offers global search with a keyboard hint and an alerts entry point', async () => {
    await renderShell();
    const trigger = screen.getByRole('button', { name: /Search LexGhana/ });
    expect(trigger.getAttribute('aria-keyshortcuts')).toContain('Control+K');
    expect(within(trigger).getByText('⌘ K')).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Alerts and notifications' }).getAttribute('href'),
    ).toBe('/app/alerts');
  });
});

describe('sidebar active state', () => {
  const cases: [string, string][] = [
    ['/app', 'Dashboard'],
    ['/app/ask', 'Ask the Law'],
    ['/app/search', 'Search'],
    ['/app/cases/sample-contract', 'Search'],
    ['/app/legislation/example-companies', 'Search'],
    ['/app/sources/sample-contract', 'Search'],
    ['/app/research', 'Research'],
    ['/app/research/sample-contract-research', 'Research'],
    ['/app/library', 'Library'],
    ['/app/alerts', 'Alerts'],
    ['/app/organization', 'Organization'],
    ['/app/settings', 'Settings'],
  ];

  it.each(cases)('%s highlights only "%s"', async (pathname, expected) => {
    const mocked = usePathname as unknown as { mockReturnValue(value: string): void };
    mocked.mockReturnValue(pathname);
    await renderShell();
    expect(currentLinks()).toEqual([expected]);
  });

  it('matches whole path segments, never mere string prefixes', () => {
    const search = allNavigation.find((item) => item.label === 'Search');
    const dashboard = allNavigation.find((item) => item.label === 'Dashboard');
    if (!search || !dashboard) throw new Error('missing navigation item');
    expect(isActive(search, '/app/searching')).toBe(false);
    expect(isActive(search, '/app/search/')).toBe(true);
    expect(isActive(dashboard, '/app/ask')).toBe(false);
    expect(isActive(dashboard, '/app/')).toBe(true);
  });
});

describe('mobile navigation', () => {
  it('opens as a dialog with the full navigation, closes on Escape and restores focus', async () => {
    const user = userEvent.setup();
    await renderShell();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Workspace navigation' });
    const nav = within(dialog).getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getAllByRole('link')).toHaveLength(9);
    expect(within(dialog).getByRole('button', { name: 'Close navigation' })).toBeDefined();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the drawer when a destination is chosen', async () => {
    const user = userEvent.setup();
    await renderShell();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Library' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the drawer’s active item in step with the current page', async () => {
    const user = userEvent.setup();
    (usePathname as unknown as { mockReturnValue(v: string): void }).mockReturnValue('/app/alerts');
    await renderShell();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const dialog = screen.getByRole('dialog');
    const current = within(dialog)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual(['Alerts']);
  });
});

describe('user menu', () => {
  it('discloses account links, and Escape closes it and returns focus to the button', async () => {
    const user = userEvent.setup();
    await renderShell();
    const button = screen.getByRole('button', { name: /Billy Gomez/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('list', { name: 'Account' });
    expect(
      within(menu).getByRole('link', { name: 'Profile and settings' }).getAttribute('href'),
    ).toBe('/app/settings');
    expect(within(menu).getByText(/Sign-out is unavailable/)).toBeDefined();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('list', { name: 'Account' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
