import { NextResponse } from 'next/server'
import { requirePermission } from '@/modules/auth'
import { syncAchPayments } from '@/modules/payments/quickbooks'

// "Check now": looks at QuickBooks for paid ACH invoices straight away,
// instead of waiting for the job that runs every few minutes.
export async function POST() {
  const auth = await requirePermission('payments.manage_quickbooks')
  if (auth.error) return auth.error
  return NextResponse.json(await syncAchPayments())
}
