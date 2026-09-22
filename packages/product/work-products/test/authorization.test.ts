import { strict as assert } from 'node:assert';
import { it } from 'vitest';

import { composeCatalog, type AuthzContext } from '@legalintel/iam';

import {
  addReviewRevision,
  createReviewState,
  effectiveRevisionApproval,
  requireWorkProductPermission,
  reviewWorkProductRevision,
  submitReviewRevision,
  workProductPermissionContribution,
  workProductPermissionKeys,
  type WorkProductPermission,
  type WorkProductReviewRequest,
} from '../src/index.js';

type Role = 'owner' | 'admin' | 'member' | 'viewer';
type Human = Extract<AuthzContext['principal'], { kind: 'user' }>;

const roles: readonly Role[] = ['owner', 'admin', 'member', 'viewer'];

const expected = {
  owner: [...workProductPermissionKeys],
  admin: [...workProductPermissionKeys],

  member: [
    'work_product:create',
    'work_product:read',
    'work_product:revise',
    'work_product:submit',
  ],

  viewer: ['work_product:read'],
} satisfies Record<Role, readonly string[]>;

function context(role: Role = 'owner'): AuthzContext {
  return {
    principal: {
      kind: 'user',
      userId: 'reviewer-1' as Human['userId'],
    },

    organizationId: 'org-A' as NonNullable<AuthzContext['organizationId']>,

    roles: [role],

    permissions: new Set(workProductPermissionContribution.orgRoleGrants[role]),
  };
}

function ready() {
  return submitReviewRevision(createReviewState('revision-1'), 'revision-1');
}

function request(decision: 'approved' | 'rejected' = 'approved'): WorkProductReviewRequest {
  return {
    id: 'review-1',
    revisionId: 'revision-1',
    decision,
    reason: decision === 'rejected' ? 'Revise the draft.' : null,
  };
}

const catalog = composeCatalog([workProductPermissionContribution]);

it('declares seven unique permissions and no staff grants', () => {
  assert.equal(new Set(workProductPermissionKeys).size, 7);
  assert.equal(catalog.permissions.size, 7);

  assert.deepEqual(workProductPermissionContribution.staffRoleGrants, {});
});

for (const role of roles) {
  it(`composes expected ${role} grants using real IAM`, () => {
    assert.deepEqual(
      [...(catalog.orgRolePermissions.get(role) ?? [])].sort(),
      [...expected[role]].sort(),
    );
  });

  for (const permission of workProductPermissionKeys) {
    it(`${role} authorization for ${permission}`, () => {
      const action = () => requireWorkProductPermission(context(role), 'org-A', permission);

      if ((expected[role] as readonly string[]).includes(permission)) {
        assert.equal(action(), 'reviewer-1');
      } else {
        assert.throws(action, { code: 'authz.denied' });
      }
    });
  }
}

for (const permission of workProductPermissionKeys) {
  it(`does not make ${permission} API-key eligible`, () => {
    assert.equal(catalog.apiKeyEligible.has(permission), false);
  });
}

for (const kind of ['api_key', 'system'] as const) {
  for (const permission of workProductPermissionKeys) {
    it(`rejects forged ${kind} context with ${permission}`, () => {
      // Deliberately malformed, overprivileged input tests denial.
      const forged = {
        ...context(),
        principal: {
          kind,
          createdBy: 'reviewer-1',
        },
      } as unknown as AuthzContext;

      assert.throws(() => requireWorkProductPermission(forged, 'org-A', permission), {
        code: 'authz.denied',
      });
    });
  }
}

it('denies cross-organization access', () => {
  assert.throws(() => requireWorkProductPermission(context(), 'org-B', 'work_product:read'), {
    code: 'authz.denied',
  });
});

it('does not substitute an owner role for permission', () => {
  assert.throws(
    () =>
      requireWorkProductPermission(
        { ...context(), permissions: new Set() },
        'org-A',
        'work_product:approve',
      ),
    { code: 'authz.denied' },
  );
});

it('denies unknown permissions even if held by the context', () => {
  const unknown = 'work_product:unknown' as WorkProductPermission;

  assert.throws(
    () =>
      requireWorkProductPermission(
        { ...context(), permissions: new Set([unknown]) },
        'org-A',
        unknown,
      ),
    { code: 'authz.denied' },
  );
});

for (const organizationId of [null, undefined, '', ' ']) {
  it(`denies invalid organization ${String(organizationId)}`, () => {
    const invalid = {
      ...context(),
      organizationId,
    } as unknown as AuthzContext;

    assert.throws(() => requireWorkProductPermission(invalid, 'org-A', 'work_product:read'), {
      code: 'authz.denied',
    });
  });
}

for (const role of roles) {
  for (const decision of ['approved', 'rejected'] as const) {
    it(`${role} ${decision} review path`, () => {
      const action = () =>
        reviewWorkProductRevision(context(role), 'org-A', ready(), 'revision-1', request(decision));

      if (role === 'owner' || role === 'admin') {
        assert.equal(action().status, decision);
      } else {
        assert.throws(action, { code: 'authz.denied' });
      }
    });
  }
}

it('ignores a reviewer identity injected into the request', () => {
  const injected = {
    ...request(),
    reviewerUserId: 'forged-user',
  };

  const result = reviewWorkProductRevision(context(), 'org-A', ready(), 'revision-1', injected);

  assert.equal(result.reviews[0]?.reviewerUserId, 'reviewer-1');
});

it('rejects cross-organization review without changing input', () => {
  const state = ready();

  assert.throws(
    () => reviewWorkProductRevision(context(), 'org-B', state, 'revision-1', request()),
    { code: 'authz.denied' },
  );

  assert.equal(state.status, 'submitted');
  assert.equal(state.reviews.length, 0);
});

it('rejects stale reviews through the authorized transition', () => {
  assert.throws(
    () => reviewWorkProductRevision(context(), 'org-A', ready(), 'old-revision', request()),
    { code: 'work_product.stale_revision' },
  );
});

it('keeps previous approval historical after a new revision', () => {
  const approved = reviewWorkProductRevision(context(), 'org-A', ready(), 'revision-1', request());

  const next = addReviewRevision(approved, 'revision-1', 'revision-2');

  assert.equal(effectiveRevisionApproval(next), null);
  assert.equal(next.reviews[0]?.revisionId, 'revision-1');
});
