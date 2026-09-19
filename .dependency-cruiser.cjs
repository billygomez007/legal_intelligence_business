/**
 * Architecture rules, enforced in CI. These are what keep the platform layer reusable for
 * other products and keep domain code independent of infrastructure. See
 * docs/25_IMPLEMENTATION_PLAN.md §1.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules impossible to extract or reason about.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'platform-must-not-import-legal',
      severity: 'error',
      comment:
        'packages/platform is product-agnostic and reusable by future business lines. It must never depend on the legal domain.',
      from: { path: '^packages/platform/' },
      to: { path: '^packages/legal/' },
    },
    {
      name: 'packages-must-not-import-apps',
      severity: 'error',
      comment: 'Dependencies point inward: apps compose packages, never the reverse.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-must-not-import-each-other',
      severity: 'error',
      comment: 'Share code through a package, not by reaching into another app.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'domain-must-not-import-adapters',
      severity: 'error',
      comment:
        'domain/ and ports/ are pure; adapters/ hold infrastructure and depend on them, not the reverse.',
      from: { path: '^packages/.+/src/(domain|ports)/' },
      to: { path: '^packages/.+/src/adapters/' },
    },
    {
      name: 'domain-must-not-import-database-package',
      severity: 'error',
      comment: 'Domain code cannot know how data is stored.',
      from: { path: '^packages/.+/src/(domain|ports)/' },
      to: { path: '^packages/platform/db/' },
    },
    {
      name: 'no-deep-imports-across-packages',
      severity: 'error',
      comment:
        'Import another package through its public entry point (src/index.ts) only. $1 is the importing package, so a package may reach into its own src freely.',
      from: { path: '^packages/([^/]+/[^/]+)/' },
      to: {
        path: '^packages/[^/]+/[^/]+/src/',
        pathNot: ['/src/(index|testing/index)\\.ts$', '^packages/$1/'],
      },
    },
    {
      name: 'apps-no-deep-imports-into-packages',
      severity: 'error',
      comment: 'Apps consume packages through their public entry point only.',
      from: { path: '^apps/' },
      to: {
        path: '^packages/[^/]+/[^/]+/src/',
        pathNot: '/src/(index|testing/index)\\.ts$',
      },
    },
    {
      name: 'testing-support-only-from-tests',
      severity: 'error',
      comment:
        'src/testing holds test-support code (database harness, guardrail checks). Production code must not depend on it.',
      from: {
        path: '^(apps|packages)/',
        pathNot: ['(^|/)test/', '\\.test\\.ts$', '/src/testing/'],
      },
      to: { path: '/src/testing/' },
    },
    {
      name: 'production-code-must-not-import-tests',
      severity: 'error',
      from: { path: '/src/', pathNot: '\\.test\\.ts$' },
      to: { path: '(^|/)test/|\\.test\\.ts$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.json'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
