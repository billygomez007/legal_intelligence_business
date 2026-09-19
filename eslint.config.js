import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.turbo/**',
    '**/generated/**',
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.config.ts', '*.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Unused values are almost always a bug; underscore prefix is the explicit opt-out.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // Use the structured, redacting logger. `console` bypasses redaction.
      'no-console': 'error',

      // All configuration flows through @legalintel/config so it is validated at startup and
      // secrets are wrapped. Direct reads scatter unvalidated configuration through the code.
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration through @legalintel/config, not process.env.',
        },
      ],
    },
  },

  // Domain and port code must stay pure: no database, network or process access. Adapters
  // are the only place infrastructure is allowed. (Package-level boundaries are enforced
  // separately by dependency-cruiser.)
  {
    files: ['packages/**/src/domain/**/*.ts', 'packages/**/src/ports/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'pg',
                'pg/*',
                'kysely',
                'node:fs',
                'node:fs/*',
                'node:net',
                'node:http*',
                'node:child_process',
              ],
              message: 'domain/ and ports/ must be pure. Move infrastructure access to adapters/.',
            },
          ],
        },
      ],
    },
  },

  // Tests and tooling may read the environment and print.
  {
    files: [
      '**/test/**/*.ts',
      '**/*.test.ts',
      '**/testing/**/*.ts',
      '**/scripts/**/*.ts',
      '**/*.config.ts',
      '**/*.config.js',
      'packages/platform/config/src/load.ts',
    ],
    rules: {
      'no-restricted-properties': 'off',
      'no-console': 'off',
    },
  },

  // Plain JavaScript / CommonJS config files are not part of any tsconfig.
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
  },
);
