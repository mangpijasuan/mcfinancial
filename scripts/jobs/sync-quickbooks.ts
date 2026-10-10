// Every few minutes from cron: records ACH payments whose QuickBooks invoice
// has been paid, and flags recorded ones QuickBooks shows unpaid again.
import { prisma } from '@/lib/prisma'
import { syncAchPayments } from '@/modules/payments/quickbooks'

syncAchPayments()
  .then(report => {
    console.log(`QuickBooks ACH payments checked: ${report.checked}; recorded: ${report.completed}; could not check: ${report.failed}; possible returns flagged: ${report.review}`)
    if (report.failed) process.exitCode = 1
  })
  .catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
