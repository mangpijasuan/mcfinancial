// The loan lifecycle: the treasurer records the bank balance (lending
// capacity), the loan officer creates a loan within it, the club and the
// borrower sign, the treasurer pays it out and finance records a repayment.
import { expect, test } from '@playwright/test'
import { MEMBER, COSIGNER, STAFF } from './fixtures'
import { clubToday, signedIn } from './helpers'

test('a loan from capacity check to first repayment', async ({ browser }) => {
  // 1. Treasury: record today's bank balance so there is lending capacity.
  const treasurer = await signedIn(browser, 'treasurer')
  await treasurer.page.goto('/treasury')
  await treasurer.page.getByLabel('End of day').fill(clubToday())
  await treasurer.page.getByLabel('Balance ($)').fill('10,000.00')
  await treasurer.page.getByRole('button', { name: 'Record balance' }).click()
  await expect(treasurer.page.getByText('$10,000.00').first()).toBeVisible()
  expect(treasurer.errors).toEqual([])

  // 2. The loan officer creates a $500 loan; the policy and capacity checks pass.
  const officer = await signedIn(browser, 'loan_officer')
  await officer.page.goto('/loans')
  await officer.page.getByRole('button', { name: 'New loan' }).click()
  const dialog = officer.page.getByRole('dialog')
  // Typed one key at a time, as a person would: the field must keep focus.
  await dialog.getByLabel('Borrower *').pressSequentially('Ada Ex', { delay: 50 })
  await expect(dialog.getByLabel('Borrower *')).toHaveValue('Ada Ex')
  await dialog.getByRole('button', { name: new RegExp(MEMBER.name) }).click()
  await dialog.getByLabel(/^Co-signer/).fill('Cara')
  await dialog.getByRole('button', { name: new RegExp(COSIGNER.name) }).click()
  await dialog.getByLabel('Loan date *').fill(clubToday())
  await dialog.getByLabel('Term *').selectOption('12')
  await dialog.getByLabel('Loan amount ($) *').fill('500')
  await expect(dialog.getByText('Policy check passed')).toBeVisible()
  await expect(dialog.getByText(/Lending capacity: \$/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Create loan + generate agreement' }).click()
  await expect(dialog).toBeHidden()
  const row = officer.page.getByRole('row', { name: new RegExp(MEMBER.name) }).first()
  await expect(row).toContainText('$500')
  const loanId = (await row.getByRole('cell').first().textContent())!.trim()
  expect(loanId).toMatch(/\S+/)
  expect(officer.errors).toEqual([])
  await officer.close()

  // 4. The borrower signs in the portal.
  const member = await signedIn(browser, 'member')
  await member.page.goto('/portal/agreements')
  await member.page.getByRole('button', { name: 'Review & sign' }).click()
  const portalSign = member.page.getByRole('dialog')
  await portalSign.getByLabel('City').fill('Tulsa')
  await portalSign.getByLabel('State').fill('OK')
  await portalSign.getByLabel('Your full legal name').fill(MEMBER.name)
  await portalSign.getByRole('button', { name: 'Sign agreement' }).click()
  await expect(portalSign.getByText(/Signed on/)).toBeVisible()
  expect(member.errors).toEqual([])

  const cosigner = await signedIn(browser, 'cosigner')
  await cosigner.page.goto('/portal/agreements')
  await cosigner.page.getByRole('button', { name: 'Review & sign' }).click()
  const cosignDialog = cosigner.page.getByRole('dialog')
  await cosignDialog.getByLabel('Your full legal name').fill(COSIGNER.name)
  await cosignDialog.getByRole('button', { name: 'Sign agreement' }).click()
  await expect(cosignDialog.getByText(/Signed on/)).toBeVisible()
  expect(cosigner.errors).toEqual([])
  await cosigner.close()

  // 3. The treasurer signs the agreement for the club.
  await treasurer.page.goto('/agreements')
  const agreement = treasurer.page.getByRole('row', { name: new RegExp(MEMBER.name) }).first()
  await agreement.getByRole('button', { name: 'View' }).click()
  const sign = treasurer.page.getByRole('dialog')
  await sign.getByLabel('Your full name').fill(STAFF.treasurer.name)
  await sign.getByRole('button', { name: 'Sign', exact: true }).click()
  // Signing closes the agreement; reopened, it carries the club's signature.
  await expect(sign).toBeHidden()
  await agreement.getByRole('button', { name: 'View' }).click()
  await expect(sign.getByText(`${STAFF.treasurer.name} ✓`)).toBeVisible()
  await sign.getByRole('button', { name: 'Close', exact: true }).click()

  // 5. The treasurer pays it out: the loan less the application fee.
  await treasurer.page.goto(`/loans/${loanId}`)
  await expect(treasurer.page.getByText('Everyone has signed. Record the payout once the money is sent.')).toBeVisible()
  await treasurer.page.getByRole('button', { name: 'Record payout' }).click()
  const payout = treasurer.page.getByRole('dialog')
  await payout.getByLabel('Date paid out').fill(clubToday())
  await payout.getByLabel('Method').selectOption('Zelle')
  await payout.getByLabel('Reference (optional)').fill('ZL-PAYOUT-1')
  await payout.getByRole('button', { name: 'Record payout' }).click()
  await expect(treasurer.page.getByText('Payout recorded.')).toBeVisible()
  await expect(treasurer.page.getByText(/Paid out \$[\d,.]+ on/)).toBeVisible()
  await expect(treasurer.page.locator('[aria-current="step"]')).toHaveText('Paid out')
  expect(treasurer.errors).toEqual([])
  await treasurer.close()

  // 6. Finance records the first repayment.
  const finance = await signedIn(browser, 'finance')
  await finance.page.goto('/loan-payments')
  await finance.page.getByRole('button', { name: 'Record repayment' }).click()
  const repay = finance.page.getByRole('dialog')
  await repay.getByLabel('Loan *').selectOption(loanId)
  await repay.getByLabel('Payment date *').fill(clubToday())
  await repay.getByLabel('Amount ($) *').fill('50')
  await repay.getByLabel('Method').selectOption('Cash')
  await repay.getByLabel('Received by').fill(STAFF.finance.name)
  await repay.getByRole('button', { name: 'Record repayment' }).click()
  await expect(repay).toBeHidden()
  const paid = finance.page.getByRole('row', { name: new RegExp(loanId) }).first()
  await expect(paid).toContainText('$50')
  expect(finance.errors).toEqual([])
  await finance.close()

  // The borrower sees the loan and its lower balance in the portal.
  // /portal opens the member's dashboard.
  await member.page.goto('/portal')
  await expect(member.page).toHaveURL(/\/portal\/dashboard$/)
  await expect(member.page.getByText(loanId).first()).toBeVisible()
  await expect(member.page.getByText('$450').first()).toBeVisible()

  // My Loan shows the schedule with the repayment against it, and the payoff.
  await member.page.getByRole('link', { name: 'See the schedule and payoff →' }).click()
  await expect(member.page.getByRole('heading', { name: 'My Loan' })).toBeVisible()
  await expect(member.page.getByRole('heading', { name: `Loan ${loanId}` })).toBeVisible()
  await expect(member.page.getByText('Being repaid')).toBeVisible()
  // $500 over 12 months: the $50 pays the first month and part of the second.
  await expect(member.page.getByRole('row').nth(1)).toContainText('Paid')
  await expect(member.page.getByRole('row').nth(2)).toContainText('Part paid')
  await expect(member.page.getByText('$50.00').first()).toBeVisible()
  await expect(member.page.getByText('To pay it off today')).toBeVisible()
  await expect(member.page.getByText('$450.00').first()).toBeVisible()
  expect(member.errors).toEqual([])
  await member.close()
})
