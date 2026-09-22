/** Database diagnostics can contain the complete rejected row, including legal content. */
export class WorkProductDatabaseError extends Error {
  readonly code: string;

  constructor(error: unknown) {
    super('Work product persistence failed.');
    this.name = 'WorkProductDatabaseError';
    // SQLSTATE is safe operational metadata. Never retain message, detail, query,
    // parameter values or cause from the driver error.
    this.code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(error.code)
        ? error.code
        : 'work_product.persistence_failed';
  }
}

export async function safeWorkProductQuery<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    throw new WorkProductDatabaseError(error);
  }
}
