// Paying by bank (ACH) through QuickBooks, end to end: the Treasurer connects
// QuickBooks (a local stand-in, e2e/fake-quickbooks.mjs) and chooses the
// products; a member pays a contribution on the QuickBooks invoice page; the
// payment is recorded once, with its receipt.
import { expect, test } from '@playwright/test'
import { MEMBER } from './fixtures'
import { signedIn } from './helpers'

test('the Treasurer connects QuickBooks and a member pays by bank', async ({ browser }) => {
  const treasurer = await signedIn(browser, 'treasurer')
  await treasurer.page.goto('/payments')
  await expect(treasurer.page.getByRole('heading', { name: 'Bank payments (ACH) through QuickBooks' })).toBeVisible()
  await treasurer.page.getByRole('link', { name: 'Connect QuickBooks' }).click()
  // Intuit's sign-in (the stand-in approves at once) sends the Treasurer back here.
  await expect(treasurer.page).toHaveURL(/\/payments\?quickbooks=connected$/)
  await expect(treasurer.page.getByText('QuickBooks is connected.')).toBeVisible()
  await treasurer.page.getByLabel('QuickBooks product for monthly dues').selectOption({ label: 'Monthly dues' })
  await treasurer.page.getByLabel('QuickBooks product for loan repayments').selectOption({ label: 'Loan repayment' })
  await treasurer.page.getByRole('button', { name: 'Save products' }).click()
  await expect(treasurer.page.getByText('Members can pay by bank')).toBeVisible()
  expect(treasurer.errors).toEqual([])

  const member = await signedIn(browser, 'member')
  await member.page.goto('/portal/pay')
  const form = member.page.getByRole('heading', { name: 'Pay monthly contribution' }).locator('..')
  await form.getByLabel('Amount').fill('20')
  await form.getByRole('button', { name: 'Bank (ACH)' }).click()
  await expect(form.getByText(/Your bank details are entered there, never here/)).toBeVisible()
  await form.getByRole('button', { name: 'Continue to bank payment' }).click()

  // QuickBooks' invoice page (the stand-in): the member pays from their bank.
  await expect(member.page.getByRole('heading', { name: /Invoice \d+: \$20\.00/ })).toBeVisible()
  await member.page.getByRole('button', { name: 'Pay $20.00 from my bank account' }).click()
  await expect(member.page.getByText('Payment sent.')).toBeVisible()

  // Back in the portal, the payment is recorded straight away.
  await member.page.goto('/portal/pay')
  const request = member.page.getByRole('region', { name: 'Your payment requests' })
  await expect(request.getByText('Bank (ACH)').first()).toBeVisible()
  await expect(request.getByText('Completed').first()).toBeVisible()
  await member.page.goto('/portal/history')
  await expect(member.page.getByText(/Bank transfer \(ACH\)/).first()).toBeVisible()
  await expect(member.page.getByText(/Receipt RC-\d{4}-\d{6}/).first()).toBeVisible()
  expect(member.errors).toEqual([])
  await member.close()

  // Staff see it as a completed bank payment, with its QuickBooks invoice.
  await treasurer.page.goto('/payments')
  await treasurer.page.getByLabel('Status').selectOption('completed')
  const row = treasurer.page.getByRole('row', { name: /QuickBooks invoice/ }).first()
  await expect(row).toContainText(MEMBER.name)
  await expect(row).toContainText('Bank (ACH)')
  await expect(row).toContainText('$20')
  expect(treasurer.errors).toEqual([])
  await treasurer.close()
})
