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
  const suggested = await page.getByLabel('Amount').nth(1).inputValue()
  await page.goto('/portal/dashboard')
  await expect(page.getByText(`$${suggested}`).first()).toBeVisible()
  expect(errors).toEqual([])
  await close()
})
