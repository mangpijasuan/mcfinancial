import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/modules/auth'
import { auditContext, recordAudit } from '@/modules/audit'
import { badRequest, readJsonObject } from '@/lib/http'
import { operationErrorResponse } from '@/lib/operationError'
import { setPortalAccess } from '@/modules/auth/memberLogins'

// Portal access for a member: a password (the first one gives access), or
// switching access on or off. The login is a member User (M8).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('members.portal_access')
  if (auth.error) return auth.error

  const { id } = await params
  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  const { password, enabled } = body
  if (password !== undefined && password !== '' && typeof password !== 'string') return badRequest('The password must be text.')
  if (enabled !== undefined && typeof enabled !== 'boolean') return badRequest('enabled must be true or false.')

  try {
    const result = await prisma.$transaction(async (tx) => {
      const changed = await setPortalAccess(tx, id, { password: password || undefined, enabled })
      const member = await tx.member.findUniqueOrThrow({ where: { id }, select: { id: true, legalName: true } })
      await recordAudit(tx, auditContext(req, auth.principal), {
        action: 'member.portal_access.update', entityType: 'member', entityId: id,
        before: { portalEnabled: changed.before },
        after: { portalEnabled: changed.after },
        metadata: { passwordChanged: changed.passwordChanged },
      })
      return { ...member, portalEnabled: changed.after }
    })
    return NextResponse.json(result)
  } catch (err) {
    const res = operationErrorResponse(err)
    if (res) return res
    throw err
  }
}
