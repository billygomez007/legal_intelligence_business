import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { composeCatalog, platformPermissions, renderPermissionMatrix } from '../src';
import { catalog } from './fixtures';

const docUrl = new URL('../../../../docs/architecture/permissions-platform.md', import.meta.url);

describe('permissions matrix document', () => {
  it('matches the catalog, so a permission change cannot land without a reviewed docs diff', () => {
    expect(existsSync(docUrl), 'run `pnpm docs:permissions` to generate it').toBe(true);
    const expected = renderPermissionMatrix(
      composeCatalog([platformPermissions]),
      'Platform permissions matrix',
    );
    expect(readFileSync(docUrl, 'utf8')).toBe(expected);
  });

  it('renders scoped permissions as separate :own and :any rows', () => {
    const rendered = renderPermissionMatrix(catalog, 't');
    expect(rendered).toContain('`project:read:own`');
    expect(rendered).toContain('`project:read:any`');
    expect(rendered).toContain('staff:data_reviewer');
  });

  it('contains no wildcard grants', () => {
    expect(renderPermissionMatrix(catalog, 't')).not.toMatch(/`[^`]*\*[^`]*`/);
  });
});
