// A member claims a Zelle payment in the portal; the treasurer confirms it,
// and it becomes a contribution with a receipt the member can see.
import { expect, test } from '@playwright/test'
import { MEMBER } from './fixtures'
import { signedIn } from './helpers'

test('a member Zelle claim is confirmed by the treasurer', async ({ browser }) => {
  const reference = `ZL-E2E-${Date.now()}`

  const member = await signedIn(browser, 'member')
  await member.page.goto('/portal/pay')
  const form = member.page.getByRole('heading', { name: 'Pay monthly contribution' }).locator('..')
  await form.getByLabel('Amount').fill('20')
  await form.getByRole('button', { name: 'Zelle' }).click()
  // The club's Zelle details copy with one tap, to paste into the bank's app.
  await member.page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await expect(form.getByText('payments@e2e.test')).toBeVisible()
  await form.getByRole('button', { name: 'Copy email' }).click()
  await expect(form.getByText('Copied', { exact: true })).toBeVisible()
  expect(await member.page.evaluate(() => navigator.clipboard.readText())).toBe('payments@e2e.test')
  await form.getByRole('button', { name: 'Copy amount' }).click()
  expect(await member.page.evaluate(() => navigator.clipboard.readText())).toBe('20.00')
  await form.getByLabel('Zelle confirmation number or note').fill(reference)
  await form.getByRole('button', { name: 'Submit Zelle claim' }).click()
  await expect(member.page.getByText(/An admin will confirm it/)).toBeVisible()
  await expect(member.page.getByText('pending').first()).toBeVisible()
  expect(member.errors).toEqual([])

  const treasurer = await signedIn(browser, 'treasurer')
  await treasurer.page.goto('/payments')
  const row = treasurer.page.getByRole('row', { name: new RegExp(reference) })
  await expect(row).toContainText(MEMBER.name)
  await expect(row).toContainText('$20')
  await row.getByRole('button', { name: 'Confirm' }).click()
  // Confirmed claims leave the review queue and show under Completed.
  await expect(row).toBeHidden()
  await treasurer.page.getByLabel('Status').selectOption('completed')
  await expect(row.getByText('completed')).toBeVisible()
  expect(treasurer.errors).toEqual([])
  await treasurer.close()

  // The claim is credited: completed in the portal, with a receipt in the history.
  await member.page.goto('/portal/pay')
  await expect(member.page.getByText('completed').first()).toBeVisible()
  await member.page.goto('/portal/history')
  await expect(member.page.getByText(/RC-\d{4}-\d{6}/).first()).toBeVisible()
  await expect(member.page.getByText('Zelle').first()).toBeVisible()
  expect(member.errors).toEqual([])
  await member.close()
})
