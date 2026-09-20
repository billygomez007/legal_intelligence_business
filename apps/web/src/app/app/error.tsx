'use client';
import { ErrorState } from '../../components/ui/primitives';
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  return <ErrorState retry={reset} />;
}
