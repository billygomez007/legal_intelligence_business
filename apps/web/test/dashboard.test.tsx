import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from '../src/app/app/page';

describe('LexGhana dashboard', () => {
  it('welcomes the user with the serif page heading and subtitle', async () => {
    render(await Dashboard());
    const heading = screen.getByRole('heading', { level: 1, name: 'Welcome back, Billy' });
    expect(heading).toBeDefined();
    expect(screen.getByText('Your legal research workspace')).toBeDefined();
  });

  it('makes Ask the Law the focal point, as a plain GET form that calls no model', async () => {
    render(await Dashboard());
    const hero = screen.getByRole('region', { name: 'Get clear answers from Ghanaian law' });
    expect(within(hero).getByText('Ask the Law')).toBeDefined();
    expect(
      within(hero).getByText('Search cases, legislation and verified legal authorities.'),
    ).toBeDefined();
    const input = within(hero).getByLabelText('Legal research question');
    expect(input.getAttribute('placeholder')).toBe('Ask a legal research question...');
    expect(within(hero).getByRole('button', { name: 'Search' })).toBeDefined();
    const form = input.closest('form');
    expect(form?.getAttribute('action')).toBe('/app/ask');
    expect((form?.getAttribute('method') ?? '').toLowerCase()).toBe('get');
    expect(within(hero).getByText(/AI research is not connected/)).toBeDefined();
  });

  it('offers the five research scopes as keyboard-operable checkboxes', async () => {
    render(await Dashboard());
    const group = screen.getByRole('group', { name: 'Research scope' });
    const names = within(group)
      .getAllByRole('checkbox')
      .map((box) => box.closest('label')?.textContent);
    expect(names).toEqual([
      'Cases',
      'Legislation',
      'Legal principles',
      'Procedural rules',
      'Recent developments',
    ]);
  });

  it('shows research activity with the four demonstration metrics and a period selector', async () => {
    const user = userEvent.setup();
    render(await Dashboard());
    const panel = screen.getByRole('region', { name: 'Research activity' });
    for (const [value, label] of [
      ['12', 'Searches performed'],
      ['5', 'Authorities saved'],
      ['3', 'Research projects'],
      ['8', 'Alerts updated'],
    ] as const) {
      const item = within(panel).getByText(label).closest('li');
      expect(item?.textContent).toContain(value);
    }
    expect(within(panel).getByText('Sample figures')).toBeDefined();
    const period = within(panel).getByRole('combobox', { name: 'Activity period' });
    expect((period as HTMLSelectElement).value).toBe('7d');
    expect(within(panel).getByRole('option', { name: 'Last 7 days' })).toBeDefined();
    await user.selectOptions(period, '30d');
    expect(within(panel).getByText('Searches performed').closest('li')?.textContent).toContain(
      '41',
    );
  });

  it('presents four quick actions with an icon, title and one-line description', async () => {
    render(await Dashboard());
    const section = screen.getByRole('region', { name: 'Quick actions' });
    const cards = within(section)
      .getAllByRole('link')
      .filter((a) => a.classList.contains('quick-card'));
    expect(cards.map((card) => card.querySelector('.quick-title')?.textContent)).toEqual([
      'Find cases',
      'Search legislation',
      'Find authority',
      'Explore related',
    ]);
    for (const card of cards) {
      expect(card.querySelector('svg')).not.toBeNull();
      expect(card.querySelector('.quick-desc')?.textContent?.length).toBeGreaterThan(10);
    }
    expect(cards[0]?.getAttribute('href')).toBe('/app/search?kind=case');
  });

  it('lists recent research with practice area, source placeholder, timestamp and status', async () => {
    render(await Dashboard());
    const panel = screen.getByRole('region', { name: 'Recent research' });
    const rows = within(panel).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
      'Sample Contract Dispute',
      'Sample Land Title Matter',
      'Example Companies Act Research',
      'Sample Employment Matter',
    ]);
    const first = rows[0];
    if (!first) throw new Error('no rows');
    expect(first.textContent).toContain('Example Trial Court');
    expect(first.textContent).toContain('Contract law');
    expect(first.textContent).toContain('2 hours ago');
    expect(first.textContent).toContain('In progress');
    expect(rows[3]?.textContent).toContain('3 days ago');
  });

  it('lists saved authorities with a trust badge each, all marked as demonstration', async () => {
    render(await Dashboard());
    const panel = screen.getByRole('region', { name: 'Saved authorities' });
    expect(within(panel).getAllByText('Verified · demo')).toHaveLength(2);
    expect(within(panel).getByText('Human reviewed · demo')).toBeDefined();
    expect(within(panel).getByText('Source available · demo')).toBeDefined();
    for (const title of [
      'Sample Case A v B',
      'Example Companies Act Provision',
      'Sample Contract Dispute',
      'Sample Employment Decision',
    ])
      expect(within(panel).getByRole('link', { name: title })).toBeDefined();
    expect(within(panel).getByText(/None is a real legal authority/)).toBeDefined();
  });

  it('shows the four legal update categories as illustrative content only', async () => {
    render(await Dashboard());
    const panel = screen.getByRole('region', { name: 'Legal updates' });
    for (const category of [
      'New judgments',
      'Legislation updates',
      'Followed topics',
      'Regulatory updates',
    ])
      expect(within(panel).getByText(category)).toBeDefined();
    expect(
      within(panel).getByText('Illustrative updates, not real legal developments.'),
    ).toBeDefined();
  });

  it('closes with the brand statement and makes no product claims beyond the interface', async () => {
    render(await Dashboard());
    const callout = screen.getByRole('complementary', { name: 'About LexGhana' });
    expect(
      within(callout).getByRole('heading', {
        name: 'Better legal information for a stronger Ghana.',
      }),
    ).toBeDefined();
    expect(callout.textContent).toContain('research, analyse and practise with confidence');
  });

  it('keeps a sensible heading hierarchy: one h1, then h2 panel headings', async () => {
    render(await Dashboard());
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName.slice(1)));
    for (let i = 1; i < levels.length; i++)
      expect((levels[i] ?? 0) - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1);
  });
});
