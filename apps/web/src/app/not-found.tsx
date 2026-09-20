import { EmptyState } from '../components/ui/primitives';
export default function NotFound() {
  return (
    <EmptyState
      title="This record isn’t available"
      description="The requested page or demonstration record could not be found."
      href="/search"
      action="Browse demonstration authorities"
    />
  );
}
