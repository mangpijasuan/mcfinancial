// Importing from a spreadsheet: the Administrator adds a member and updates
// another's phone; the Treasurer records a contribution. Each import is
// previewed first, saves everything or nothing, and cannot run twice.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { MEMBER } from './fixtures'
import { signedIn } from './helpers'

const file = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) })

test('the Administrator imports members from a spreadsheet', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'administrator')
  await page.goto('/members')
  await page.getByRole('link', { name: 'Import from spreadsheet' }).click()
  await expect(page.getByRole('heading', { name: 'Import members', level: 1 })).toBeVisible()

  const members = file('members.csv', `Member ID,Legal name,Joined,Phone\r\n,Ivy Import,2026-09-01,555-0142\r\n${MEMBER.id},,,555-0199\r\n`)
  await page.getByLabel('CSV file to import').setInputFiles(members)
  await expect(page.getByText('Preview: nothing has been saved yet')).toBeVisible()
  await expect(page.getByText(/1 to add · 1 to update · 0 unchanged · 0 with errors/)).toBeVisible()
  await expect(page.getByText(/Phone: .* → 555-0199/)).toBeVisible()
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations
  expect(violations.map((v) => v.id)).toEqual([])

  await page.getByRole('button', { name: 'Import 2 members' }).click()
  await expect(page.getByText(/Imported \(IMP-[\w-]+\): 1 added, 1 updated\./)).toBeVisible()

  // The same file again: shown, but refused.
  await page.getByLabel('CSV file to import').setInputFiles(members)
  await expect(page.getByText(/This file was already imported/)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Import \d+ members?$/ })).toBeDisabled()

  await page.goto('/members?search=Ivy')
  await expect(page.getByRole('cell', { name: 'Ivy Import' })).toBeVisible()
  expect(errors).toEqual([])
  await close()
})

test('the Treasurer imports contributions, and a file with an error saves nothing', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'treasurer')
  await page.goto('/contributions')
  await page.getByRole('link', { name: 'Import' }).click()
  await expect(page.getByRole('heading', { name: 'Import contributions', level: 1 })).toBeVisible()

  await page.getByLabel('CSV file to import').setInputFiles(file('bad.csv', `Member ID,Paid on,Amount\r\n${MEMBER.id},2026-09-15,15\r\nMC-NOPE,2026-09-15,15\r\n`))
  await expect(page.getByText('There is no member MC-NOPE.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record 1 contribution' })).toBeDisabled()

  await page.getByLabel('CSV file to import').setInputFiles(file('good.csv', `Member ID,Paid on,Amount,Method,Note\r\n${MEMBER.id},2026-09-15,15,Cash,Imported in the browser test\r\n`))
  await expect(page.getByText(/1 to add · 0 with errors/)).toBeVisible()
  await page.getByRole('button', { name: 'Record 1 contribution' }).click()
  await expect(page.getByText(/Imported \(IMP-[\w-]+\): 1 added\./)).toBeVisible()
  expect(errors).toEqual([])
  await close()
})
