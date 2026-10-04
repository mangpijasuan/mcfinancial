// Every role reaches its screens; nothing logs an error (hydration
// mismatches included) and phone layouts do not scroll sideways.
import { expect, test } from '@playwright/test'
import { expectNoOverflow, signedIn } from './helpers'

const SCREENS: Record<string, string[]> = {
  treasurer: ['/dashboard', '/members', '/contributions', '/dues', '/withdrawals', '/ledger', '/treasury', '/reconciliation', '/loans', '/agreements', '/loan-payments', '/approvals', '/settings/audit'],
  finance: ['/contributions', '/payments', '/withdrawals', '/ledger/comparison'],
  loan_officer: ['/loans', '/agreements', '/treasury'],
  board: ['/approvals', '/ledger', '/settings/staff'],
}

for (const [role, paths] of Object.entries(SCREENS)) {
  test(`${role} screens load cleanly`, async ({ browser }) => {
    const { page, errors, close } = await signedIn(browser, role as never)
    for (const path of paths) {
      await page.goto(path)
      await expect(page.locator('h1').first()).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}$`))
    }
    expect(errors).toEqual([])
    await close()
  })
}

test('phone layouts fit the screen', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'treasurer', { width: 390, height: 844 })
  for (const path of ['/dashboard', '/members', '/contributions', '/treasury', '/reconciliation', '/approvals']) {
    await page.goto(path)
    await expect(page.locator('h1').first()).toBeVisible()
    await expectNoOverflow(page)
  }
  expect(errors).toEqual([])
  await close()
})

test('the member portal loads cleanly', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'member', { width: 390, height: 844 })
  for (const path of ['/portal/dashboard', '/portal/history', '/portal/pay', '/portal/agreements']) {
    await page.goto(path)
    await expect(page.locator('h1, h2').first()).toBeVisible()
    await expectNoOverflow(page)
  }
  expect(errors).toEqual([])
  await close()
})
