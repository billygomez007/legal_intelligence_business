declare const brand: unique symbol;

/**
 * Nominal typing for values that share a runtime representation. A `UserId` and an
 * `OrganizationId` are both strings, but passing one where the other is expected is a
 * compile error. This matters most for tenancy: the wrong identifier in the wrong place
 * is how cross-tenant bugs are written.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
