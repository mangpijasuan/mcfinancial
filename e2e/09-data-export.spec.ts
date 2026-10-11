// The Treasurer downloads the club's records as spreadsheets (CSV). The
// Google Sheets copy is not set up in the tests, and the page says so.
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { MEMBER } from './fixtures'
import { signedIn } from './helpers'

test('the Treasurer downloads the members as a spreadsheet', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'treasurer')
  await page.goto('/dashboard')
  await page.getByRole('navigation', { name: 'Staff navigation' }).getByRole('link', { name: 'Data Export' }).click()
  await expect(page.getByRole('heading', { name: 'Data Export', level: 1 })).toBeVisible()

  const downloading = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download Members (CSV)' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^millionaires-club-members-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = fs.readFileSync((await download.path())!, 'utf8')
  expect(csv).toContain('Member ID,Legal name')
  expect(csv).toContain(MEMBER.id)

  await expect(page.getByText(/Not set up on this server yet/)).toBeVisible()
  expect(errors).toEqual([])
  await close()
})

test('staff without the export permission do not see it', async ({ browser }) => {
  const { page, close } = await signedIn(browser, 'finance')
  await page.goto('/dashboard')
  await expect(page.getByRole('navigation', { name: 'Staff navigation' }).getByRole('link', { name: 'Data Export' })).toHaveCount(0)
  await page.goto('/settings/data')
  await expect(page.getByRole('heading', { name: 'You don’t have access to this page' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Download .* \(CSV\)/ })).toHaveCount(0)
  await close()
})
