import { redirect } from 'next/navigation';

export default async function MatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/app/matters/${id}/overview`);
}
