// M9: the Treasurer links the 2021–2025 loans to members by ID. Exact names
// link in one go; a name two members share and a name with no member are
// decided by hand; the loan still owing moves to the live loans at the
// confirmed balance, and the co-signer sees it in the portal.
import { expect, test } from '@playwright/test'
import { OTHER_MEMBER } from './fixtures'
import { signedIn } from './helpers'

test('older loans linked by member ID, and an open one moved to the live loans', async ({ browser }) => {
  const treasurer = await signedIn(browser, 'treasurer')
  const page = treasurer.page
  await page.goto('/loan-history')
  await page.getByRole('link', { name: 'Link older loans to members' }).click()
  await expect(page).toHaveURL(/\/loan-history\/review$/)

  // 1. Ada's name belongs to one member: as borrower on HE-1 and co-signer on HE-2.
  await page.getByRole('button', { name: 'Link 2 exact matches' }).click()
  await expect(page.getByRole('status')).toHaveText('Linked 2 names to their members.')

  // 2. "Ben Example" is two members: the Treasurer picks the right one for HE-2.
  const ben = page.getByRole('row', { name: /HE-2/ })
  await expect(ben).toContainText('2 members have this name')
  await ben.getByLabel(`Member for ${OTHER_MEMBER.name} (borrower) on HE-2`).selectOption(OTHER_MEMBER.id)
  await ben.getByRole('button', { name: 'Link' }).click()
  await expect(page.getByRole('status')).toContainText(`${OTHER_MEMBER.name}: linked on 1 loan`)

  // 3. "Old Member" is no one in the club now.
  const old = page.getByRole('row', { name: /HE-3/ })
  await old.getByLabel('Member for Old Member (borrower) on HE-3').selectOption({ label: 'No member record' })
  await old.getByRole('button', { name: 'Link' }).click()
  await expect(page.getByText('Nothing to review.')).toBeVisible()

  // 4. HE-2 is still marked Active: the Treasurer confirms $400 owed at the end of 2025.
  await page.getByLabel('Balance owed on HE-2 ($)').fill('400')
  await page.getByLabel('At the end of').fill('2025-12-31')
  await page.getByRole('button', { name: 'Confirm balance' }).click()
  await expect(page.getByRole('status')).toHaveText('HE-2: $400.00 owed, now in the live loans.')
  await expect(page.getByText(/Confirmed \$400\.00 owed at the end of 2025-12-31/)).toBeVisible()
  await expect(page.getByText('3 of 3')).toBeVisible()

  // The live loans now carry it, for the member it was linked to.
  await page.goto('/loans')
  const loan = page.getByRole('row', { name: /HE-2/ })
  await expect(loan).toContainText(OTHER_MEMBER.name)
  await expect(loan).toContainText('$400')
  await loan.click()
  await expect(page).toHaveURL(/\/loans\/HE-2$/)
  await expect(page.getByRole('heading', { name: 'HE-2' })).toBeVisible()
  expect(treasurer.errors).toEqual([])
  await treasurer.close()

  // Ada co-signed HE-2: linked by her member ID, she sees it in the portal.
  const member = await signedIn(browser, 'member')
  await member.page.goto('/portal/history')
  await expect(member.page.getByText('HE-2').first()).toBeVisible()
  await expect(member.page.getByText(new RegExp(`Borrower: ${OTHER_MEMBER.name}`))).toBeVisible()
  expect(member.errors).toEqual([])
  await member.close()
})
