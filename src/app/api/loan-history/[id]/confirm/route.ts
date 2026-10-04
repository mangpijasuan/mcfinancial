import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/modules/auth'
import { auditContext } from '@/modules/audit'
import { badRequest, readJsonObject } from '@/lib/http'
import { isIsoDate } from '@/lib/dates'
import { parseDollars } from '@/lib/money'
import { operationErrorResponse } from '@/lib/operationError'
import { confirmBalance } from '@/modules/loans/history'

// The Treasurer confirms what an older loan marked Active still owes (M9).
// A balance still owed moves the loan to the live loans.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('loans.link_history')
  if (auth.error) return auth.error

  const { id } = await params
  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  if (!isIsoDate(body.asOf)) return badRequest('asOf must be a date (YYYY-MM-DD).')
  let balanceCents
  try {
    balanceCents = parseDollars(String(body.balance ?? '').replace(/^\$/, '').replace(/,/g, ''))
  } catch {
    return badRequest('The balance must be a dollar amount with at most two decimals.')
  }
  try {
    const result = await prisma.$transaction(
      (tx) => confirmBalance(tx, { id, balanceCents, asOf: body.asOf }, auth.principal.id, auditContext(req, auth.principal)),
      { timeout: 60_000 },
    )
    return NextResponse.json(result)
  } catch (err) {
    const res = operationErrorResponse(err)
    if (res) return res
    throw err
  }
}
