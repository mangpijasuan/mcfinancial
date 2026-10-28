// Year by year: a member's contributions, loan payments and borrowing by
// year, each year opening into its months, in the portal and for staff.
// Runs after the contribution and loan specs, so this year has activity.
import { expect, test } from '@playwright/test'
import { MEMBER } from './fixtures'
import { clubToday, signedIn } from './helpers'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

test('member: each year with its total, this year month by month', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'member', { width: 390, height: 844 })
  await page.goto('/portal/history')
  await expect(page.getByRole('heading', { name: 'Year by year' })).toBeVisible()
  const [year, month] = clubToday().split('-').map(Number)

  // This year is open: its months so far, newest first, with a total row.
  const table = page.getByRole('table', { name: `${year} month by month` })
  await expect(table).toBeVisible()
  await expect(table.getByRole('rowheader').first()).toHaveText(MONTHS[month - 1])
  await expect(table.getByRole('rowheader', { name: 'January' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Loan payments' })).toBeVisible()
  await expect(table.getByRole('row', { name: /^Total/ })).toBeVisible()

  // 2025 is kept as a yearly total only: it opens to say so.
  const older = page.locator('summary', { hasText: '2025' })
  await expect(older).toContainText('$240.00')
  await older.click()
  await expect(page.getByText("The club's records for 2025 keep the year's total only: $240.00 contributed")).toBeVisible()
  expect(errors).toEqual([])
  await close()
})

test('staff: the same on the member page', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'treasurer')
  await page.goto(`/members/${MEMBER.id}`)
  await expect(page.getByRole('heading', { name: 'Year by year' })).toBeVisible()
  await expect(page.getByRole('table', { name: `${clubToday().slice(0, 4)} month by month` })).toBeVisible()
  await expect(page.locator('summary', { hasText: '2025' })).toContainText('$240.00')
  expect(errors).toEqual([])
  await close()
})
