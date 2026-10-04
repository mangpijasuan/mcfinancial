import { type Browser, type Page, expect } from '@playwright/test'
import { type StaffRole, authFile } from './fixtures'

/** A page signed in as a role, failing the test on any browser console error (hydration errors included). */
export async function signedIn(browser: Browser, role: StaffRole | 'member', viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ storageState: authFile(role), viewport })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  return { page, errors, close: () => context.close() }
}

/** The page fits the screen width (no sideways scrolling). */
export async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
}

/** Today in the club's time zone (America/Chicago), as the app sees it. */
export function clubToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
