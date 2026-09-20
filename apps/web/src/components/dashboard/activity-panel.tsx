'use client';

import { useState } from 'react';
import type { ActivityPeriod } from '../../data/types';
import { DemoBadge } from '../legal';
import { ActivityMetric } from './activity-metric';

export function ResearchActivityPanel({ periods }: { periods: ActivityPeriod[] }) {
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? '');
  const period = periods.find((item) => item.id === periodId) ?? periods[0];
  if (!period) return null;
  return (
    <section className="panel dash-panel dash-activity" aria-labelledby="activity-title">
      <div className="panel-header">
        <h2 id="activity-title" className="panel-title">
          Research activity
        </h2>
        <label className="select-chip">
          <span className="sr-only">Activity period</span>
          <select
            value={period.id}
            onChange={(event) => {
              setPeriodId(event.target.value);
            }}
          >
            {periods.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="metric-list">
        {period.metrics.map((metric) => (
          <ActivityMetric key={metric.id} metric={metric} />
        ))}
      </ul>
      <p className="micro activity-note">
        <DemoBadge label="Sample figures" /> Illustrative numbers, not calculated from real
        activity.
      </p>
    </section>
  );
}
