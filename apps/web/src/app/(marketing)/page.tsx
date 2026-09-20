import { redirect } from 'next/navigation';
import { routes } from '../../lib/routes';

// Temporary: the public site replaces this page in the marketing commit.
export default function HomePage() {
  redirect(routes.app);
}
