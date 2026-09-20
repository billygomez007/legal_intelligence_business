import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { MatterHeader } from '../../../../components/matters/matter-header';
import { getMatterWorkspace } from '../../../../data/matter-workspace';

export default async function MatterLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const matter = getMatterWorkspace(id);

  if (!matter) {
    notFound();
  }

  return (
    <div className="matter-workspace">
      <MatterHeader matter={matter} />
      <div className="matter-content">{children}</div>
    </div>
  );
}
