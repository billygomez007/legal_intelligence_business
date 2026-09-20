'use client';

import { useSyncExternalStore } from 'react';
import { formatLongDate } from '../../lib/format';

function subscribe() {
  return noop;
}

function noop() {
  // The date never changes while the page is open; there is nothing to subscribe to.
}

/**
 * Today's date, rendered only in the browser. Server output is empty, so a statically rendered
 * page can never ship a stale date, and hydration cannot mismatch.
 */
export function TodayLabel() {
  const label = useSyncExternalStore(
    subscribe,
    () => formatLongDate(new Date()),
    () => '',
  );
  return <p className="welcome-date">{label}</p>;
}
