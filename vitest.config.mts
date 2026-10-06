import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { testDatabaseUrl } from './tests/setup/testDatabaseUrl'

const databaseUrl = testDatabaseUrl()

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globalSetup: ['tests/setup/globalSetup.ts'],
    setupFiles: ['tests/setup/session.ts'],
    // The money path, and member sign-in, must be fully tested (docs/architecture/11 §3):
    // `npm run test:coverage` fails if any of these drops below 100%.
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/money/**', 'src/lib/dates.ts', 'src/modules/loans/amortization/**', 'src/modules/accounting/ledger/**',
        'src/modules/loans/state.ts', 'src/modules/loans/postings.ts', 'src/modules/accounting/autoPost.ts',
        'src/modules/contributions/dues.ts', 'src/modules/contributions/index.ts',
        'src/modules/accounting/opening.ts', 'src/modules/accounting/legacyActivity.ts',
        'src/modules/treasury/liquidity.ts', 'src/modules/treasury/index.ts', 'src/modules/accounting/comparison.ts',
        'src/modules/accounting/reconciliation.ts', 'src/modules/loans/history.ts',
        'src/modules/accounting/reads.ts',
        'src/modules/auth/memberLogins.ts', 'src/modules/membership/numbers.ts', 'src/modules/data/fileCheck.ts', 'src/lib/hosts.ts', 'src/modules/loans/memberView.ts', 'src/modules/accounting/statements.ts',
      ],
      exclude: ['**/*.test.ts'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      reporter: ['text-summary'],
    },
    // Integration tests share one database, so files run one at a time.
    fileParallelism: false,
    env: {
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
      NEXTAUTH_SECRET: 'test-only-secret',
      // 32 zero bytes: a test-only key for encrypting TOTP secrets.
      MFA_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      SECURITY_ALERT_EMAIL: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      RESEND_API_KEY: '',
    },
  },
})
