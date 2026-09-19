import { writeFileSync } from 'node:fs';

import { composeCatalog, platformPermissions, renderPermissionMatrix } from '../src';

/**
 * Regenerates docs/architecture/permissions-platform.md. Products contribute their own
 * permissions at the composition root, which will render a combined matrix once a product
 * exists; this covers the platform layer on its own.
 */
const target = new URL('../../../../docs/architecture/permissions-platform.md', import.meta.url);
writeFileSync(
  target,
  renderPermissionMatrix(composeCatalog([platformPermissions]), 'Platform permissions matrix'),
);
console.log(`wrote ${target.pathname}`);
