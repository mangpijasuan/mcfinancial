// Nightly from cron: refreshes the read-only Google Sheets copy of the
// club's records (docs/operations/data-export.md).
import { prisma } from '@/lib/prisma'
import { systemAuditContext } from '@/modules/audit'
import { exportToGoogleSheets, sheetsConfig } from '@/modules/data/googleSheets'

if (!sheetsConfig()) {
  console.log('The Google Sheets copy is not set up (GOOGLE_SHEETS_EXPORT_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY): nothing to do.')
} else {
  exportToGoogleSheets(systemAuditContext('sheets-export'))
    .then((r) => console.log(`Google Sheets copy refreshed: ${r.tabs.map((t) => `${t.title} ${t.rows}`).join(', ')}`))
    .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1 })
    .finally(() => prisma.$disconnect())
}
