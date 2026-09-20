'use client';

import { useState } from 'react';
import { BellRing, BookOpen, Scale, ScrollText, type LucideIcon } from 'lucide-react';
import type { Alert } from '../../data/types';
import { Button } from '../ui/primitives';

const typeMeta: Record<Alert['type'], { icon: LucideIcon; blurb: string }> = {
  Topic: { icon: BellRing, blurb: 'A subject or legal concept' },
  Case: { icon: Scale, blurb: 'A specific case' },
  Legislation: { icon: BookOpen, blurb: 'An Act or instrument' },
  Regulatory: { icon: ScrollText, blurb: 'Regulator notices' },
};

/** Alert list with temporary pause/activate toggles. Nothing is saved and nothing is sent. */
export function AlertManager({ initialAlerts }: { initialAlerts: Alert[] }) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [notice, setNotice] = useState('');
  return (
    <>
      <div className="notice">
        <div>
          <strong>Notification preview only</strong>
          <p>
            Toggle example statuses to explore the interface. Nothing is saved and no notifications
            are sent.
          </p>
        </div>
      </div>
      <ul className="type-tiles" aria-label="Alert types">
        {(Object.keys(typeMeta) as Alert['type'][]).map((type) => {
          const { icon: Icon, blurb } = typeMeta[type];
          return (
            <li className="type-tile" key={type}>
              <span className="icon-tile sm">
                <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <div>
                <p className="type-name">{type}</p>
                <p className="micro">{blurb}</p>
              </div>
              <p className="type-count">{alerts.filter((a) => a.type === type).length}</p>
            </li>
          );
        })}
      </ul>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Demonstration alerts</caption>
          <thead>
            <tr>
              <th scope="col">Alert name</th>
              <th scope="col">Type</th>
              <th scope="col">Frequency</th>
              <th scope="col">Status · demo</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => {
              const { icon: Icon } = typeMeta[alert.type];
              const active = alert.status === 'Active';
              return (
                <tr key={alert.id}>
                  <td>{alert.name}</td>
                  <td>
                    <span className="type-cell">
                      <Icon size={15} aria-hidden="true" />
                      {alert.type}
                    </span>
                  </td>
                  <td>{alert.frequency}</td>
                  <td>
                    <span className={`status ${active ? 'success' : 'muted'}`}>{alert.status}</span>
                  </td>
                  <td>
                    <Button
                      className="secondary sm"
                      aria-label={`${active ? 'Pause' : 'Activate'} ${alert.name}`}
                      onClick={() => {
                        setAlerts((items) =>
                          items.map((item) =>
                            item.id === alert.id
                              ? { ...item, status: active ? 'Paused' : 'Active' }
                              : item,
                          ),
                        );
                        setNotice(
                          'Example status updated in this view only. No notification service is connected.',
                        );
                      }}
                    >
                      {active ? 'Pause' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p role="status" className="micro">
        {notice}
      </p>
    </>
  );
}
