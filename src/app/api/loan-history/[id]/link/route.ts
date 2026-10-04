import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/modules/auth'
import { auditContext } from '@/modules/audit'
import { badRequest, readJsonObject } from '@/lib/http'
import { operationErrorResponse } from '@/lib/operationError'
import { linkName } from '@/modules/loans/history'

// The Treasurer links a name on an older loan to a member, or records that
// there is none (M9).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('loans.link_history')
  if (auth.error) return auth.error

  const { id } = await params
  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  if (body.role !== 'borrower' && body.role !== 'cosigner') return badRequest('role must be borrower or cosigner.')
  if (body.memberId !== null && !(typeof body.memberId === 'string' && body.memberId)) return badRequest('memberId must be a member ID, or null for no member record.')
  try {
    const result = await prisma.$transaction(
      (tx) => linkName(tx, { id, role: body.role, memberId: body.memberId, sameName: body.sameName === true }, auditContext(req, auth.principal)),
      { timeout: 60_000 },
    )
    return NextResponse.json(result)
  } catch (err) {
    const res = operationErrorResponse(err)
    if (res) return res
    throw err
  }
}
