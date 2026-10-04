// ESLint (`npm run lint`), run in CI. Next.js 16 lints with the ESLint
// CLI; its own config (eslint-config-next) is left out because its plugin
// depends on a `braces` with an unfixed high-severity advisory, and CI
// fails on any. The same React, React Hooks and TypeScript rule sets are
// used directly, plus the import boundaries below.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

const restrict = (patterns) => ({
  '@typescript-eslint/no-restricted-imports': ['error', { patterns: patterns.map((p) => ({ ...p, allowTypeImports: true })) }],
})
const UI = { group: ['@/app/*', '@/components/*'], message: 'Domain code never depends on pages or components.' }

export default tseslint.config(
  { ignores: ['.next/**', '.next-dev/**', 'out/**', 'build/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**', 'prisma/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { ...react.configs.flat.recommended, settings: { react: { version: 'detect' } } },
  react.configs.flat['jsx-runtime'],
  reactHooks.configs.flat['recommended-latest'],
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // The older screens pass API responses around as `any`; new code types them.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'react/prop-types': 'off',
      // Screens load their data in an effect and set a loading flag first: the
      // usual pattern here, and correct. Moving data loading to server
      // components or a data library is its own change, not a lint fix.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  // Plain Node scripts (CommonJS).
  {
    files: ['**/*.js', '**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // ── Import boundaries (docs/architecture/10) ──────────────────────────
  // Pages and components reach data through API routes and domain modules,
  // never the database client.
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    ignores: ['src/app/api/**'],
    rules: restrict([{ group: ['@/lib/prisma'], message: 'Pages and components never use the database client: go through an API route or a module.' }]),
  },
  // Domain modules and shared code never depend on the UI.
  {
    files: ['src/modules/**/*.ts', 'src/lib/**/*.ts'],
    rules: restrict([UI]),
  },
  // The pure core (money, dates, the loan schedule, the ledger's rules, and
  // the dues helpers screens use) imports no server code, only types: it is
  // tested on its own and is safe to run in the browser.
  {
    files: [
      'src/lib/money/**/*.ts', 'src/lib/dates.ts', 'src/modules/loans/amortization/**/*.ts',
      'src/modules/accounting/ledger/**/*.ts', 'src/modules/contributions/dues.ts',
    ],
    rules: restrict([
      UI,
      { group: ['@/lib/prisma', '@/modules/*', '@/lib/*', '!@/lib/money', '!@/lib/money/*', '!@/lib/dates'], message: 'The pure core imports only money and dates (types from elsewhere are fine).' },
      { group: ['@prisma/client'], message: 'The pure core imports Prisma types only.' },
    ]),
  },
)
