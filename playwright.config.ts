// Browser tests (Playwright): the golden paths, end to end, against a
// production build on its own database. `npm run test:e2e`.
import { defineConfig, devices } from '@playwright/test'
import { BASE_URL, PORT, e2eEnv } from './e2e/fixtures'

export default defineConfig({
  testDir: 'e2e',
  // One database shared in order: opening balances come after the loan, and so on.
  fullyParallel: false,
  workers: 1,
  // No retries: each spec changes the shared database, so a rerun would not
  // start from the same state. A failure keeps its trace and screenshot.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    // The browser keeps the club's clock, as members and staff do.
    timezoneId: 'America/Chicago',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: e2eEnv(),
  },
})
