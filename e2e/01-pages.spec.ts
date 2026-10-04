// Every role reaches every screen its permissions show in the navigation;
// nothing logs an error (hydration mismatches included) and phone layouts do
// not scroll sideways. The list comes from the production navigation and
// role definitions, so a new screen is covered as soon as it is added.
import { expect, test } from '@playwright/test'
import { visibleNav } from '@/components/staff/nav'
import { permissionsForRoles } from '@/modules/permissions'
import { STAFF, type StaffRole } from './fixtures'
import { expectNoOverflow, signedIn } from './helpers'

// Screens reached from another page rather than the navigation.
const SUB_PAGES: Partial<Record<StaffRole, string[]>> = { treasurer: ['/ledger/opening', '/ledger/comparison'] }

function screensFor(role: StaffRole): string[] {
  return [...visibleNav([...permissionsForRoles([STAFF[role].role])]).map((item) => item.href), ...(SUB_PAGES[role] ?? [])]
}

for (const role of Object.keys(STAFF) as StaffRole[]) {
  test(`${role} screens load cleanly`, async ({ browser }) => {
    const { page, errors, close } = await signedIn(browser, role)
    const paths = screensFor(role)
    expect(paths.length).toBeGreaterThan(3)
    for (const path of paths) {
      await page.goto(path)
      await expect(page.locator('h1').first(), path).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}$`))
    }
    expect(errors).toEqual([])
    await close()
  })
}

test('phone layouts fit the screen', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'treasurer', { width: 390, height: 844 })
  for (const path of screensFor('treasurer')) {
    await page.goto(path)
    await expect(page.locator('h1').first(), path).toBeVisible()
    await expectNoOverflow(page)
  }
  expect(errors).toEqual([])
  await close()
})

test('the member portal loads cleanly', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'member', { width: 390, height: 844 })
  for (const path of ['/portal/dashboard', '/portal/history', '/portal/pay', '/portal/agreements']) {
    await page.goto(path)
    await expect(page.locator('h1, h2').first(), path).toBeVisible()
    await expectNoOverflow(page)
  }
  expect(errors).toEqual([])
  await close()
})
