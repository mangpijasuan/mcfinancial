// The ledger: the accountant's chart approval is recorded, the treasurer
// proposes opening balances and the Board approves them, the nightly
// comparison runs clean, and December 2025 is reconciled with the bank and
// closed.
import { expect, test } from '@playwright/test'
import { signedIn } from './helpers'

// Member capital at the cutover: the seeded archive totals ($2,000 + $1,000).
const BANK_AT_CUTOVER = '3,000.00'

test('opening balances, approval, comparison and month-end close', async ({ browser }) => {
  const treasurer = await signedIn(browser, 'treasurer')
  const page = treasurer.page

  // 1. Record the accountant's approval of the chart of accounts.
  await page.goto('/ledger')
  await page.getByRole('button', { name: 'Record approval' }).click()
  const approve = page.getByRole('dialog')
  await approve.getByLabel('Who confirmed it, and when').fill('E2E Accountant CPA, letter dated 2026-10-01')
  await approve.getByLabel('The club’s accountant has approved these accounts.').check()
  await approve.getByRole('button', { name: 'Approve chart of accounts' }).click()
  await expect(approve).toBeHidden()

  // 2. Propose the opening balances: the bank on 31 December 2025 ties to member capital.
  await page.goto('/ledger/opening')
  await page.getByLabel('Bank balance the day before ($)').fill(BANK_AT_CUTOVER)
  await page.getByRole('button', { name: 'Update report' }).click()
  await expect(page.getByText('the books tie')).toBeVisible()
  await page.getByLabel(/I have checked the loan balances at the cutover/).check()
  await page.getByRole('button', { name: 'Send for approval' }).click()
  const sent = page.getByText(/Sent for approval \(\S+\)/)
  await expect(sent).toBeVisible()
  const publicId = (await sent.textContent())!.match(/Sent for approval \((\S+)\)/)![1]

  // 3. A Board member approves them; everything is posted in one go.
  const board = await signedIn(browser, 'board')
  await board.page.goto('/approvals')
  const request = board.page.locator('div').filter({ hasText: publicId }).filter({ has: board.page.getByRole('button', { name: 'Approve' }) }).last()
  await request.getByRole('button', { name: 'Approve' }).click()
  await expect(board.page.getByText(/Approved; done/)).toBeVisible()
  expect(board.errors).toEqual([])
  await board.close()

  await page.goto('/ledger/opening')
  await expect(page.getByText(/Opening balances were posted from 2026-01-01/)).toBeVisible()

  // 4. The nightly comparison finds the ledger and the old records agree.
  await page.goto('/ledger/comparison')
  await page.getByRole('button', { name: 'Run the comparison now' }).click()
  await expect(page.getByText('No differences').first()).toBeVisible()

  // 5. December 2025 reconciles with the bank statement, then closes.
  await page.goto('/reconciliation')
  await page.getByLabel('Month').selectOption('2025-12')
  await page.getByLabel('Statement balance ($)').fill(BANK_AT_CUTOVER)
  await page.getByRole('button', { name: 'Reconcile' }).click()
  await expect(page.getByText(/December 2025 reconciles: the bank and the ledger agree/)).toBeVisible()
  const december = page.getByRole('row', { name: /December 2025/ })
  await december.getByRole('button', { name: 'Close month' }).click()
  await expect(page.getByText('December 2025 is closed.')).toBeVisible()
  await expect(december).toContainText('Closed')
  expect(treasurer.errors).toEqual([])
  await treasurer.close()
})
