import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell, CommandSearch } from '../src/components/shell';
import { SourceCard } from '../src/components/legal';
import { AskWorkbench } from '../src/components/ask-workbench';
import { SearchFilters } from '../src/components/search-filters';
import { AlertManager, LibraryView } from '../src/components/demo-interactions';
import { webClients, emptySearch } from '../src/data/mock-clients';
import Dashboard from '../src/app/page';

describe('legal research foundation', () => {
  it('renders all navigation, skip link and persistent demonstration identity', () => {
    render(
      <AppShell>
        <p>Workspace content</p>
      </AppShell>,
    );
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    for (const name of [
      'Dashboard',
      'Ask the Law',
      'Search',
      'Research',
      'Library',
      'Alerts',
      'Organization',
      'Settings',
    ])
      expect(within(nav).getByRole('link', { name })).toBeDefined();
    expect(screen.getByText('Demonstration data')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe(
      '#main-content',
    );
  });
  it('renders the lawyer dashboard with explicitly synthetic recent research', async () => {
    render(await Dashboard());
    expect(screen.getByRole('heading', { name: 'Ask Ghanaian Law' })).toBeDefined();
    expect(screen.getByLabelText('Legal research question')).toBeDefined();
    expect(screen.getAllByText('Sample Contract Dispute').length).toBeGreaterThan(0);
    expect(screen.getByText('Illustrative updates, not real legal developments.')).toBeDefined();
  });
  it('labels every search filter', async () => {
    render(<SearchFilters query={emptySearch} authorities={await webClients.authorities.list()} />);
    for (const name of [
      'Jurisdiction',
      'Court / source',
      'Document type',
      'Year',
      'Practice area',
      'Legal concept',
    ])
      expect(screen.getByRole('combobox', { name })).toBeDefined();
  });
  it('exposes source provenance, version and an inspectable document link', async () => {
    const source = await webClients.authorities.source('sample-contract');
    if (!source) throw new Error('Missing fixture');
    render(<SourceCard source={source} />);
    expect(screen.getByText('Human reviewed · demo')).toBeDefined();
    expect(screen.getByText('Source available · demo')).toBeDefined();
    expect(screen.getByText(/Document: sample-contract · Version: DEMO-v1/)).toBeDefined();
    expect(screen.getByRole('link', { name: /Open source document/ }).getAttribute('href')).toBe(
      '/sources/sample-contract',
    );
  });
  it('keeps unavailable or restricted sources free of source text', async () => {
    const source = await webClients.authorities.source('sample-employment');
    if (!source) throw new Error('Missing fixture');
    render(<SourceCard source={source} />);
    expect(screen.getByText('Rights restricted')).toBeDefined();
    expect(screen.queryByText('Primary source · synthetic fixture')).toBeNull();
  });
  it('does not answer arbitrary questions and separates the fixed synthesis from sources', async () => {
    const user = userEvent.setup();
    const source = await webClients.authorities.source('sample-contract');
    if (!source) throw new Error('Missing fixture');
    render(
      <AskWorkbench
        initialQuestion="My legal question"
        answer={await webClients.research.exampleAnswer()}
        sources={[source]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Preview research workflow' }));
    expect(screen.getByText('No legal answer was generated')).toBeDefined();
    expect(screen.queryByRole('region', { name: 'AI synthesis example' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'View fixed demonstration answer' }));
    expect(screen.getByRole('region', { name: 'AI synthesis example' })).toBeDefined();
    const rail = screen.getByRole('complementary', { name: 'Source documents' });
    expect(within(rail).getByText('Primary source · synthetic fixture')).toBeDefined();
    expect(within(rail).queryByText('Example research answer')).toBeNull();
  });
  it('opens command search with a keyboard, traps focus and restores it on Escape', async () => {
    const user = userEvent.setup();
    render(<CommandSearch />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Find a page/ }));
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(document.activeElement).toBe(screen.getByLabelText('Search pages'));
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Close command search' }),
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Find a page/ }));
  });
  it('filters library contents and supplies the report empty state', async () => {
    const user = userEvent.setup();
    render(
      <LibraryView
        authorities={await webClients.authorities.list()}
        projects={await webClients.research.list()}
      />,
    );
    await user.selectOptions(screen.getByLabelText('Saved content'), 'legislation');
    expect(screen.getByRole('link', { name: 'Example Companies Act Provision' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Sample Contract Dispute' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Saved content'), 'reports');
    expect(screen.getByText('No research reports yet')).toBeDefined();
  });
  it('marks alert changes as temporary without mutating the adapter', async () => {
    const user = userEvent.setup();
    render(<AlertManager initialAlerts={await webClients.alerts.list()} />);
    await user.click(screen.getByRole('button', { name: 'Pause Example contract research' }));
    expect(screen.getByRole('status').textContent).toContain('this view only');
    expect((await webClients.alerts.list())[0]?.status).toBe('Active');
  });
});
