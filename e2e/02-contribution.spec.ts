// Finance records a member's dues in cash; the receipt is numbered and
// printable, and the member sees it in the portal.
import { expect, test } from '@playwright/test'
import { MEMBER } from './fixtures'
import { clubToday, signedIn } from './helpers'

test('record a contribution and print its receipt', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'finance')
  await page.goto('/contributions')
  const open = page.getByRole('button', { name: 'Record payment' })
  const dialog = page.getByRole('dialog')
  // Keyboard: focus moves into the dialog, Escape closes it and focus returns.
  await open.click()
  await expect(dialog.getByPlaceholder('Type name or ID to search…')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(open).toBeFocused()
  await open.click()
  await dialog.getByPlaceholder('Type name or ID to search…').pressSequentially('Ada', { delay: 50 })
  await dialog.getByRole('button', { name: new RegExp(MEMBER.name) }).click()
  await dialog.getByLabel('Payment date *').fill(clubToday())
  await dialog.getByLabel('Amount ($) *').fill('40')
  await dialog.getByLabel('Payment method').selectOption('Cash')
  await dialog.getByLabel('Received by').fill('Fin Finance')
  await dialog.getByRole('button', { name: 'Record payment' }).click()
  await expect(dialog).toBeHidden()

  await expect(page.getByText(/Receipt RC-\d{4}-\d{6} issued: Dues/)).toBeVisible()
  const row = page.getByRole('row', { name: new RegExp(MEMBER.name) }).first()
  await expect(row).toContainText('$40')
  await expect(row).toContainText('Cash')
  const receipt = row.getByRole('link', { name: /^RC-\d{4}-\d{6}$/ })
  const receiptNumber = await receipt.textContent()
  await receipt.click()
  await expect(page.getByText(receiptNumber!).first()).toBeVisible()
  await expect(page.getByText('Contribution receipt')).toBeVisible()
  await expect(page.getByText(/\$40(\.00)?/).first()).toBeVisible()
  expect(errors).toEqual([])
  await close()

  // The member sees the payment and its receipt in the portal.
  const member = await signedIn(browser, 'member')
  await member.page.goto('/portal/history')
  await expect(member.page.getByText(receiptNumber!).first()).toBeVisible()
  expect(member.errors).toEqual([])
  await member.close()
})
