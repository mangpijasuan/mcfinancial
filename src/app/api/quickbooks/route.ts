import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/modules/auth'
import { auditContext } from '@/modules/audit'
import { badRequest, readJsonObject } from '@/lib/http'
import { QuickBooksError, disconnect, listItems, quickBooksStatus, setItems } from '@/modules/payments/quickbooks'

// The club's QuickBooks connection, for the Treasurer: whether members can
// pay by ACH, the products their invoices use, and disconnecting.
export async function GET() {
  const auth = await requirePermission('payments.manage_quickbooks')
  if (auth.error) return auth.error
  const status = await quickBooksStatus()
  if (!status.connected) return NextResponse.json({ status, items: [] })
  try {
    return NextResponse.json({ status, items: await listItems() })
  } catch (err) {
    return NextResponse.json({ status, items: [], error: err instanceof Error ? err.message : 'QuickBooks did not answer.' })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePermission('payments.manage_quickbooks')
  if (auth.error) return auth.error
  const body = await readJsonObject(req)
  const duesItemId = typeof body?.duesItemId === 'string' ? body.duesItemId : ''
  const loanItemId = typeof body?.loanItemId === 'string' ? body.loanItemId : ''
  if (!duesItemId || !loanItemId) return badRequest('Choose a product for dues and one for loan repayments.')
  try {
    await setItems({ duesItemId, loanItemId }, auditContext(req, auth.principal))
  } catch (err) {
    if (err instanceof QuickBooksError) return NextResponse.json({ error: err.message }, { status: 400 })
    throw err
  }
  return NextResponse.json({ status: await quickBooksStatus() })
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission('payments.manage_quickbooks')
  if (auth.error) return auth.error
  await disconnect(auditContext(req, auth.principal))
  return NextResponse.json({ status: await quickBooksStatus() })
}
