import { type Browser, type Page, expect } from '@playwright/test'
import { type StaffRole, authFile } from './fixtures'

/**
 * A page signed in as a role, failing the test on any browser console error
 * (hydration errors included). Contexts made from the `browser` fixture take
 * the config's `use` options (baseURL, time zone).
 */
export async function signedIn(browser: Browser, role: StaffRole | 'member' | 'cosigner', viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ storageState: authFile(role), viewport })
  const page = await context.newPage()
  const errors: string[] = []
  // Leaving a page while the sign-in library is still checking the session makes the browser
  // cancel that one request, and the library logs it as an error. That is the test navigating
  // away, not a fault: only that cancelled session check is ignored, whichever event comes first.
  const isSessionAbort = (text: string) => text.includes('CLIENT_FETCH_ERROR') && text.includes('/api/auth/session')
  let sessionAborted = false
  page.on('requestfailed', (r) => {
    if (!r.url().includes('/api/auth/session')) return
    sessionAborted = true
    for (let i = errors.length - 1; i >= 0; i--) if (isSessionAbort(errors[i])) errors.splice(i, 1)
  })
  page.on('console', (m) => { if (m.type() === 'error' && !(sessionAborted && isSessionAbort(m.text()))) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  // Confirmations the flows ask for are accepted; an alert is how the app
  // reports a failed request, so it fails the test.
  page.on('dialog', (d) => {
    if (d.type() === 'alert') errors.push(`alert: ${d.message()}`)
    void d.accept()
  })
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
