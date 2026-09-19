import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ambient, per-request context. Identifiers only: this object is copied into every log line,
 * so it must never hold content, credentials or personal data.
 */
export interface RequestContext {
  requestId: string;
  organizationId?: string;
  principalId?: string;
  principalKind?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run({ ...context }, fn);
}

export function getContext(): Readonly<RequestContext> | undefined {
  return storage.getStore();
}

/** Adds fields once they become known (e.g. the organization, after authentication). */
export function enrichContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store !== undefined) Object.assign(store, patch);
}
