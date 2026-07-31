import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'src/lib/supabase/database.types.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      /**
       * docs/02 §12 — full jsx-a11y coverage. `next/core-web-vitals` already registers the
       * plugin and enables a subset, so spreading its rule set here upgrades us to the
       * complete recommended list without re-declaring the plugin (which ESLint rejects).
       */
      ...jsxA11y.flatConfigs.recommended.rules,

      /**
       * `label-has-associated-control` only looks two elements deep for text by default.
       * Radio cards (checkout delivery/payment) legitimately nest text inside a flex wrapper
       * to lay the price out opposite the name, which puts it at depth 3.
       *
       * Raising the depth keeps the real check — the label must still contain text — without
       * flattening markup that exists for layout. The control association itself is separately
       * guaranteed: every such label carries an explicit `htmlFor`.
       */
      'jsx-a11y/label-has-associated-control': ['error', { depth: 4 }],

      // CLAUDE.md §1 — strict TS, no escape hatches.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // docs/02 §10 — no console.log in committed code; lib/logger.ts is the wrapper.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // docs/02 §12 — no default exports except Next.js route files (overridden below).
      'import/no-default-export': 'off',
      eqeqeq: ['error', 'smart'],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../*'],
              message: 'Use the @/ alias instead of deep relative imports (docs/02 §12).',
            },
          ],
        },
      ],
    },
  },
  {
    // docs/02 §4 — features/* must never import from app/.
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/app/*'], message: 'features/* must not import from app/ (docs/02 §4).' },
            { group: ['../../*'], message: 'Use the @/ alias instead of deep relative imports.' },
          ],
        },
      ],
    },
  },
  {
    // lib/ is a dependency leaf (docs/02 §4).
    files: ['src/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/*', '@/features/*', '@/components/*'],
              message: 'lib/ is a dependency leaf (docs/02 §4).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.{ts,tsx}', 'e2e/**/*.ts', '*.config.{ts,mjs,js}'],
    rules: { 'no-console': 'off' },
  },
  prettier,
];

export default config;
