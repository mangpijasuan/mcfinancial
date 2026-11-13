// Usability and accessibility of the main workflows (docs/ui/usability-audit.md):
// navigation, dashboards, loans and agreements, payments and approvals. Runs
// after the other specs, so the pages show real data: an overdue loan, a
// signed agreement, payments and contributions.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { expectNoOverflow, signedIn } from './helpers'

/** WCAG 2.1 A and AA rules, as automated checks can test them. */
async function accessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)
}

test('staff: the whole menu fits a laptop screen, and the current page is marked', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'treasurer', { width: 1280, height: 900 })
  await page.goto('/approvals')
  const menu = page.getByRole('navigation', { name: 'Staff navigation' })
  for (const link of await menu.getByRole('link').all()) {
    const box = await link.boundingBox()
    expect(box, await link.innerText()).not.toBeNull()
    expect(box!.y + box!.height, `${await link.innerText()} is below the fold`).toBeLessThanOrEqual(900)
  }
  await expect(menu.getByRole('link', { name: 'Approvals' })).toHaveAttribute('aria-current', 'page')
  expect(errors).toEqual([])
  await close()
})

test('staff: Lending has three entries; the older records are a tab under Loans', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'treasurer')
  await page.goto('/loans')
  const menu = page.getByRole('navigation', { name: 'Staff navigation' })
  // Once it loads, the Loans entry also announces its overdue count ("Loans 1 item needs attention").
  const loans = menu.getByRole('link', { name: /^Loans\b/ })
  await expect(loans).toBeVisible()
  for (const name of ['Loan Agreements', 'Repayments']) await expect(menu.getByRole('link', { name, exact: true })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Loan History' })).toHaveCount(0)

  const tabs = page.getByRole('navigation', { name: 'Loans' })
  await expect(tabs.getByRole('link', { name: 'Current loans' })).toHaveAttribute('aria-current', 'page')
  await tabs.getByRole('link', { name: '2021–2025 records' }).click()
  await expect(page).toHaveURL(/\/loan-history$/)
  await expect(tabs.getByRole('link', { name: '2021–2025 records' })).toHaveAttribute('aria-current', 'page')
  // Still under Loans in the menu.
  await expect(loans).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('link', { name: 'Link older loans to members' })).toBeVisible()
  expect(errors).toEqual([])
  await close()
})

test('staff: every search box and filter has a name', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'treasurer')
  const lists: [string, string, string][] = [
    ['/members', 'Search name or ID', 'Member status'],
    ['/loans', 'Search borrower or loan ID', 'Loan status'],
    ['/agreements', 'Search borrower or ID', 'Agreement status'],
    ['/contributions', 'Search member or ID', 'Payment method'],
    ['/withdrawals', 'Search member', 'Withdrawal type'],
  ]
  for (const [path, search, filter] of lists) {
    await page.goto(path)
    await expect(page.getByRole('searchbox', { name: search, exact: true }), path).toBeVisible()
    await expect(page.getByRole('combobox', { name: filter, exact: true }), path).toBeVisible()
  }
  expect(errors).toEqual([])
  await close()
})

test('staff: loans and agreements keep status and actions in view on a laptop', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'treasurer', { width: 1280, height: 900 })
  const inView = async (name: string) => {
    const box = await page.getByRole('columnheader', { name }).boundingBox()
    expect(box, name).not.toBeNull()
    expect(box!.x + box!.width, `${name} is cut off`).toBeLessThanOrEqual(1280)
  }
  await page.goto('/loans')
  await expect(page.getByRole('cell', { name: '⚠ Overdue' })).toBeVisible()
  for (const name of ['Balance', 'Next due', 'Status', 'Agreement']) await inView(name)
  await page.goto('/agreements')
  await expect(page.getByRole('heading', { name: 'Loan Agreements', level: 1 })).toBeVisible()
  await expect(page.getByText(/^1 agreement ·/)).toBeVisible()
  for (const name of ['Status', 'Actions']) await inView(name)
  expect(errors).toEqual([])
  await close()
})

test('staff: the dashboard shows attention in red only where it is needed', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'treasurer')
  await page.goto('/dashboard')
  // The demo data has one older loan overdue (05-loan-history).
  await expect(page.getByText('Need follow-up')).toBeVisible()
  await expect(page.getByText('Total withdrawn')).toBeVisible()
  // On each chart the axis labels differ ($1k, $1.5k), not $1k, $1k, $1k.
  const axes = page.locator('.recharts-yAxis')
  expect(await axes.count()).toBeGreaterThan(0)
  for (const axis of await axes.all()) {
    const ticks = await axis.locator('.recharts-cartesian-axis-tick-value').allTextContents()
    expect(ticks.length).toBeGreaterThan(1)
    expect(new Set(ticks).size, ticks.join(' ')).toBe(ticks.length)
  }
  expect(errors).toEqual([])
  await close()
})

test('staff: a page outside your roles says so, without errors', async ({ browser }) => {
  // The treasurer role does not include Staff & Roles.
  const { page, errors, close } = await signedIn(browser, 'treasurer')
  await page.goto('/settings/staff')
  await expect(page.getByRole('heading', { name: 'You don’t have access to this page' })).toBeVisible()
  await page.getByRole('link', { name: 'Go to your start page' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  expect(errors).toEqual([])
  await close()
})

test('staff: the main workflow pages pass automated accessibility checks', async ({ browser }) => {
  const { page, close } = await signedIn(browser, 'treasurer')
  for (const path of ['/dashboard', '/loans', '/agreements', '/payments', '/approvals', '/members']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    expect(await accessibilityViolations(page), path).toEqual([])
  }
  await close()
})

test('member: plain-language loan eligibility, figures to the cent, no sideways scrolling', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'member', { width: 390, height: 844 })
  await page.goto('/portal/dashboard')
  await expect(page.getByText('You have a loan, or co-sign one, still being repaid.')).toBeVisible()
  await expect(page.getByText(/NO - /)).toHaveCount(0)
  for (const path of ['/portal/dashboard', '/portal/pay', '/portal/loan', '/portal/agreements', '/portal/history']) {
    await page.goto(path)
    await expectNoOverflow(page)
    expect(await accessibilityViolations(page), path).toEqual([])
  }
  // The loan payment the form suggests matches the monthly figure shown, to the cent.
  await page.goto('/portal/pay')
  await page.getByRole('button', { name: /^My loan/ }).click()
  await expect(page.getByRole('heading', { name: 'Pay toward my loan' })).toBeVisible()
  const suggested = await page.getByLabel('Amount', { exact: true }).inputValue()
  await page.goto('/portal/dashboard')
  await expect(page.getByText(`$${suggested}`).first()).toBeVisible()
  expect(errors).toEqual([])
  await close()
})

test('phones: tapping a field does not zoom the page (16px text in fields)', async ({ browser }) => {
  // iPhone Safari zooms in on fields with smaller text, and the zoom stays on
  // the dashboard after signing in, cutting off the right edge.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  const fieldSizes = () => page.locator('input:visible, select:visible, textarea:visible')
    .evaluateAll((els) => els.map((e) => `${e.getAttribute('name') ?? e.id}: ${getComputedStyle(e).fontSize}`))
  for (const path of ['/portal/login', '/login']) {
    await page.goto(path)
    for (const size of await fieldSizes()) expect(parseFloat(size.split(': ')[1]), size).toBeGreaterThanOrEqual(16)
  }
  await context.close()

  const phone = await browser.newContext({ storageState: 'e2e/.auth/member.json', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const pay = await phone.newPage()
  await pay.goto('/portal/pay')
  await expect(pay.getByLabel('Amount').first()).toBeVisible()
  const sizes = await pay.locator('input:visible, select:visible').evaluateAll((els) => els.map((e) => getComputedStyle(e).fontSize))
  expect(sizes.length).toBeGreaterThan(0)
  // At least 16px; the amount fields are larger on purpose.
  for (const size of sizes) expect(parseFloat(size)).toBeGreaterThanOrEqual(16)
  await phone.close()
})

test('member: one tap from Home pays what is owed, the card is under the account, and the loan schedule fits a phone', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'member', { width: 390, height: 844 })
  await page.goto('/portal/dashboard')
  // The welcome card offers to pay exactly what is owed, already filled in.
  const pay = page.getByRole('link', { name: /^Pay \$[\d,]+\.\d{2}$/ })
  await expect(pay).toBeVisible()
  const owed = (await pay.textContent())!.trim().replace('Pay $', '').replace(/,/g, '')
  await pay.click()
  await expect(page).toHaveURL(/\/portal\/pay\?for=dues&amount=/)
  await expect(page.getByRole('heading', { name: 'Pay monthly contribution' })).toBeVisible()
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue(owed)
  // Suggested amounts fill the field in one tap.
  await page.getByRole('button', { name: /^This month/ }).click()
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('20.00')
  await expect(page.getByRole('button', { name: /^This month/ })).toHaveAttribute('aria-pressed', 'true')
  // The membership card is in the account menu, shown as it will download.
  await page.goto('/portal/dashboard')
  await page.getByRole('button', { name: 'Your account' }).click()
  await page.getByRole('link', { name: 'Membership card' }).click()
  await expect(page).toHaveURL(/\/portal\/card$/)
  await expect(page.getByRole('img', { name: /^Membership card for / })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download membership card' })).toBeVisible()
  // On a phone the schedule is a list: every status visible, nothing off to the side.
  await page.goto('/portal/loan')
  const schedule = page.getByRole('list', { name: 'Repayment schedule' })
  await expect(schedule).toBeVisible()
  await expect(schedule.getByRole('listitem').first()).toContainText(/Paid|Due|Late|Upcoming|Part paid/)
  await expectNoOverflow(page)
  expect(await accessibilityViolations(page)).toEqual([])
  expect(errors).toEqual([])
  await close()
})

test('member: a long name is squeezed to fit the membership card, as in the download', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'member', { width: 1280, height: 900 })
  // The same member with a long name: the signature must not run into the verse beside it.
  await page.route('**/api/portal/me', async (route) => {
    const res = await route.fetch()
    const me = await res.json()
    await route.fulfill({ response: res, json: { ...me, legalName: 'Mangpi Dominic Jasuan-Thangnuam' } })
  })
  await page.goto('/portal/card')
  const signature = page.locator('svg text[data-line="signature"]')
  await expect(signature).toBeVisible()
  // The card signature space is 322 units wide (the download squeezes to the same); a little slack for glyph edges.
  await expect.poll(async () => signature.evaluate((el: SVGTextElement) => Math.round(el.getBBox().width))).toBeLessThanOrEqual(332)
  const name = page.locator('svg text[data-line="name"]')
  await expect.poll(async () => name.evaluate((el: SVGTextElement) => Math.round(el.getBBox().width))).toBeLessThanOrEqual(520)
  expect(errors).toEqual([])
  await close()
})
