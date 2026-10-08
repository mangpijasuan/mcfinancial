import { prisma } from '@/lib/prisma'
import { retryStripeEvents } from '@/modules/payments/stripe'

retryStripeEvents()
  .then(report => {
    console.log(`Stripe events checked: ${report.checked}; still failing: ${report.failed}`)
    if (report.failed) process.exitCode = 1
  })
  .catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
