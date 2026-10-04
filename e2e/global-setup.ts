// Before the browser tests: a fresh, migrated, seeded database, then each
// role signs in once through the real sign-in pages (password, then the
// authenticator code) and the session is saved for the tests to reuse.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { type FullConfig, chromium, expect } from '@playwright/test'
import { BASE_URL, MEMBER, STAFF, STAFF_PASSWORD, type StaffRole, authFile, e2eEnv, totp } from './fixtures'

export default async function globalSetup(_config: FullConfig) {
  const env = { ...process.env, ...e2eEnv() }
  execSync('npx prisma migrate deploy', { env, stdio: 'inherit' })
  execSync('npx tsx e2e/seed.ts', { env, stdio: 'inherit' })
  fs.mkdirSync('e2e/.auth', { recursive: true })

  const browser = await chromium.launch()
  for (const role of Object.keys(STAFF) as StaffRole[]) {
    const context = await browser.newContext({ baseURL: BASE_URL })
    const page = await context.newPage()
    await page.goto('/login')
    await page.getByLabel('Email').fill(STAFF[role].email)
    await page.getByLabel('Password').fill(STAFF_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByLabel('Authentication code').fill(totp())
    await page.getByRole('button', { name: 'Verify' }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
    await context.storageState({ path: authFile(role) })
    await context.close()
  }

  const context = await browser.newContext({ baseURL: BASE_URL })
  const page = await context.newPage()
  await page.goto('/portal/login')
  await page.getByLabel('Member ID').fill(MEMBER.id)
  await page.getByLabel('Password').fill(MEMBER.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/portal\/dashboard/, { timeout: 20_000 })
  await context.storageState({ path: authFile('member') })
  await browser.close()
}
