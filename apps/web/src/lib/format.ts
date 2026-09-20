const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/**
 * "2 hours ago", relative to an explicit reference time rather than the wall clock, so that
 * demonstration data renders identically on the server, in tests and in the browser.
 */
export function relativeTime(iso: string, asOf: string): string {
  const seconds = (Date.parse(iso) - Date.parse(asOf)) / 1000;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit);
  }
  return 'just now';
}

const longDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** "Friday, 15 November 2024". */
export function formatLongDate(date: Date): string {
  return longDate.format(date);
}

const shortDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  // Fixture dates are calendar dates (UTC midnight); never let the viewer's timezone shift them.
  timeZone: 'UTC',
});

/** "14 Apr 2025", from an ISO calendar date. */
export function formatShortDate(iso: string): string {
  return shortDate.format(new Date(iso));
}
