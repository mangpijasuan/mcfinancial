// Bulk Upload: Finance records a loan repayment from a spreadsheet, and
// sends a contribution's reversal for approval. Runs after the contribution
// and loan specs, so the test member has a receipt and a loan being repaid.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { MEMBER } from './fixtures'
import { clubToday, signedIn } from './helpers'

const file = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) })

test('Finance uploads loan repayments and contribution reversals', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'finance')
  await page.goto('/dashboard')
  await page.getByRole('link', { name: 'Bulk Upload' }).click()
  await expect(page.getByRole('heading', { name: 'Bulk Upload', level: 1 })).toBeVisible()
  for (const card of ['Import contributions', 'Reverse contributions', 'Import loan repayments']) {
    await expect(page.getByRole('region', { name: card })).toBeVisible()
  }
  // Finance may not add members: that card is not shown.
  await expect(page.getByRole('region', { name: 'Import members' })).toHaveCount(0)

  // Each card offers a sample file to fill in.
  const repayments = page.getByRole('region', { name: 'Import loan repayments' })
  const download = page.waitForEvent('download')
  await repayments.getByRole('link', { name: 'Download sample file' }).click()
  expect((await download).suggestedFilename()).toBe('loan-payments-sample.csv')

  // The member's loan and latest receipt, as the app lists them.
  const loans = await (await page.request.get(`/api/loans?search=${MEMBER.id}`)).json()
  const loanId = loans.find((l: any) => l.borrowerId === MEMBER.id && l.balanceRemaining > 1).loanId
  const contributions = await (await page.request.get(`/api/contributions?search=${MEMBER.id}`)).json()
  const receipt = contributions.contributions.find((c: any) => c.receiptNumber && !c.reversedAt).receiptNumber

  await repayments.getByLabel(/CSV file to import/).setInputFiles(file('repayments.csv', `Loan ID,Paid on,Amount,Method\r\n${loanId},${clubToday()},1.00,Cash\r\n`))
  await expect(repayments.getByText('Preview: nothing has been saved yet')).toBeVisible()
  await expect(repayments.getByText(/1 to add · 0 with errors/)).toBeVisible()
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations
  expect(violations.map((v) => v.id)).toEqual([])
  await repayments.getByRole('button', { name: 'Record 1 repayment' }).click()
  await expect(repayments.getByText(/Imported \(IMP-[\w-]+\): 1 added\./)).toBeVisible()

  const reversals = page.getByRole('region', { name: 'Reverse contributions' })
  await expect(reversals.getByText(/each reversal is sent to Approvals/)).toBeVisible()
  await reversals.getByLabel(/CSV file to import/).setInputFiles(file('reversals.csv', `Receipt,Reason\r\n${receipt},Browser test: recorded twice\r\nRC-NONE,Typo\r\n`))
  await expect(reversals.getByText('There is no contribution with the receipt or number RC-NONE.')).toBeVisible()
  await expect(reversals.getByRole('button', { name: 'Send 1 reversal for approval' })).toBeDisabled()
  await reversals.getByLabel(/CSV file to import/).setInputFiles(file('reversals-fixed.csv', `Receipt,Reason\r\n${receipt},Browser test: recorded twice\r\n`))
  await reversals.getByRole('button', { name: 'Send 1 reversal for approval' }).click()
  await expect(reversals.getByText(/Sent for approval \(IMP-[\w-]+\): 1 reversal\./)).toBeVisible()

  await page.goto('/approvals')
  await expect(page.getByText(new RegExp(`Reverse ${receipt}`)).first()).toBeVisible()
  expect(errors).toEqual([])
  await close()
})
