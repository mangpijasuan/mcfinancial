// Every role reaches every screen its permissions show in the navigation;
// nothing logs an error (hydration mismatches included) and phone layouts do
// not scroll sideways. The list comes from the production navigation and
// role definitions, so a new screen is covered as soon as it is added.
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { visibleNav } from '@/components/staff/nav'
import { permissionsForRoles } from '@/modules/permissions'
import { MEMBER, STAFF, type StaffRole } from './fixtures'
import { expectNoOverflow, signedIn } from './helpers'

// Screens reached from another page rather than the navigation.
const SUB_PAGES: Partial<Record<StaffRole, string[]>> = {
  treasurer: ['/ledger/opening', '/ledger/comparison', '/ledger/reads', '/loan-history/review', '/contributions/import'],
  administrator: ['/members/import'],
}

function screensFor(role: StaffRole): string[] {
  const nav = visibleNav([...permissionsForRoles([STAFF[role].role])])
  // Tabs inside a menu entry (Loans → 2021–2025 records) are screens too.
  return [...nav.flatMap((item) => [item.href, ...(item.also ?? [])]), ...(SUB_PAGES[role] ?? [])]
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
  for (const path of ['/portal/dashboard', '/portal/history', '/portal/pay', '/portal/loan', '/portal/statements', '/portal/agreements']) {
    await page.goto(path)
    await expect(page.locator('h1, h2').first(), path).toBeVisible()
    await expectNoOverflow(page)
  }
  expect(errors).toEqual([])
  await close()
})

test('an active member downloads their personalized membership card', async ({ browser }) => {
  const { page, close } = await signedIn(browser, 'member')
  try {
    await page.goto('/portal/dashboard')
    const cardText = await page.evaluateHandle(() => {
      const entries: { text: string; font: string }[] = []
      const fillText = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
        entries.push({ text, font: this.font })
        fillText.call(this, text, x, y, maxWidth)
      }
      return entries
    })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download membership card' }).click(),
    ])
    expect(download.suggestedFilename()).toBe(`Millionaires-Club-${MEMBER.id}.png`)
    const path = await download.path()
    if (!path) throw new Error('Membership card download is missing')
    const png = await readFile(path)
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(await cardText.jsonValue()).toEqual([
      { text: MEMBER.name, font: expect.stringContaining('Georgia') },
      { text: MEMBER.id, font: expect.stringContaining('Georgia') },
      { text: '2024', font: expect.stringContaining('Georgia') },
      { text: MEMBER.name, font: expect.stringContaining('Allura') },
    ])
  } finally {
    await close()
  }
})
