// The monthly report on the Contributions page: the month's figures and
// every member, downloaded as a PDF or CSV. Runs after the contribution
// spec, so the test member has paid this month.
import { expect, test } from '@playwright/test'
import { MEMBER } from './fixtures'
import { clubToday, signedIn } from './helpers'

test('the Treasurer downloads this month’s report as a PDF and a CSV', async ({ browser }) => {
  const { page, errors, close } = await signedIn(browser, 'treasurer')
  await page.goto('/contributions')
  await page.getByRole('link', { name: 'Monthly report' }).click()
  const report = page.getByRole('region', { name: 'Monthly report' })
  await expect(report.getByRole('heading', { name: 'Monthly report' })).toBeInViewport()

  const month = clubToday().slice(0, 7)
  await expect(report.getByLabel('Report month')).toHaveValue(month)
  await expect(report.getByText('Members paid')).toBeVisible()
  const row = report.getByRole('row', { name: new RegExp(MEMBER.id) })
  await expect(row).toContainText(MEMBER.name)
  await expect(row).toContainText('$')

  const pdf = page.waitForEvent('download')
  await report.getByRole('link', { name: 'Download PDF' }).click()
  const file = await pdf
  expect(file.suggestedFilename()).toBe(`Millionaires-Club-Monthly-Contributions-${month}.pdf`)
  const bytes = await (await file.createReadStream()).toArray()
  expect(Buffer.concat(bytes).subarray(0, 5).toString()).toBe('%PDF-')

  const csv = page.waitForEvent('download')
  await report.getByRole('link', { name: 'CSV' }).click()
  expect((await csv).suggestedFilename()).toBe(`Millionaires-Club-Monthly-Contributions-${month}.csv`)
  expect(errors).toEqual([])
  await close()
})
