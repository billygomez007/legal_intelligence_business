import { EmptyState } from '../../components/ui/primitives';
import { routes } from '../../lib/routes';
export default function NotFound() {
  return (
    <EmptyState
      title="This record isn’t available"
      description="The requested page or demonstration record could not be found."
      href={routes.search}
      action="Browse demonstration authorities"
    />
  );
}
