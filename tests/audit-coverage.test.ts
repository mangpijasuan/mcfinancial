// Every route that changes data must write an audit entry. This static
// check fails when a POST/PATCH/PUT/DELETE handler is added without one.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const API_DIR = path.resolve(__dirname, '../src/app/api')

// Handlers that accept POST but change nothing.
const READ_ONLY = new Set(['loans/check-policy', 'auth/[...nextauth]'])

function routeFiles(dir = API_DIR): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(full)
    return entry.name === 'route.ts' ? [full] : []
  })
}

describe('audit coverage', () => {
  const writers = routeFiles()
    .map((file) => ({ route: path.relative(API_DIR, path.dirname(file)).split(path.sep).join('/'), source: fs.readFileSync(file, 'utf8') }))
    .filter(({ route, source }) => !READ_ONLY.has(route) && /export async function (POST|PATCH|PUT|DELETE)\b/.test(source))

  // Either directly, or through a module function that records its own
  // entry (each is covered by its own tests).
  const AUDITED = /\b(recordAudit|submitOrExecute|decideApproval|cancelApproval|changeDuesPlan|reconcileBank|closePeriod|linkExactMatches|linkName|confirmBalance|processStripeEvent)\(/

  it.each(writers)('/api/$route records an audit entry', ({ source }) => {
    expect(source).toMatch(AUDITED)
  })
})
