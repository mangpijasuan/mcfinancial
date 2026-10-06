// The ledger: the accountant's chart approval is recorded, the treasurer
// proposes opening balances and the Board approves them, the nightly
// comparison runs clean, December 2025 is reconciled with the bank and
// closed, the ledger and the records agree on every figure screens show,
// and members' statements start.
import { expect, test } from '@playwright/test'
import { MEMBER } from './fixtures'
import { signedIn } from './helpers'

// The books tie when the bank equals member capital (the seeded archive
// totals, $2,000 + $1,000) less the older loan still owed at the cutover
// ($400 on HE-2, confirmed in 05-loan-history).
const BANK_AT_CUTOVER = '2,600.00'

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

  // 6. Before switching screens to the ledger (M6): every figure agrees with the records.
  await page.goto('/ledger/reads')
  await expect(page.getByText('The records', { exact: true })).toBeVisible()
  await expect(page.getByText("Every member's contributions and withdrawals agree.")).toBeVisible()
  await expect(page.getByText("Every paid-out loan's balance agrees.")).toBeVisible()

  // 7. Statements start: the member sees this year's, and staff see the same one.
  const member = await signedIn(browser, 'member')
  await member.page.goto('/portal/statements')
  await member.page.getByLabel('Statement for').selectOption({ label: 'Year 2026 (to date)' })
  await expect(member.page.getByRole('heading', { name: 'Statement · Year 2026 (to date)' })).toBeVisible()
  const capital = member.page.getByRole('region', { name: 'Your capital' })
  await expect(capital.getByRole('row', { name: /Balance at the end/ })).toBeVisible()
  const closing = await capital.getByRole('row', { name: /Balance at the end/ }).textContent()
  expect(member.errors).toEqual([])
  await member.close()

  await page.goto(`/members/${MEMBER.id}`)
  await page.getByRole('button', { name: 'Statements' }).click()
  await page.getByLabel('Statement for').selectOption({ label: 'Year 2026 (to date)' })
  await expect(page.getByText(`${MEMBER.name} · ${MEMBER.id}`)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Your capital' }).getByRole('row', { name: /Balance at the end/ })).toHaveText(closing!)

  expect(treasurer.errors).toEqual([])
  await treasurer.close()
})
