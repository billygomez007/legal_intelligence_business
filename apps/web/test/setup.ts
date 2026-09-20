import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(cleanup);
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
