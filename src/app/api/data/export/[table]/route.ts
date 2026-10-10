import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/modules/auth'
import { auditContext, recordAudit } from '@/modules/audit'
import { prisma } from '@/lib/prisma'
import { buildExport, isExportKey, toCsv } from '@/modules/data/export'

// One of the club's tables as a CSV download. It holds members' personal
// details, so every download is recorded in the audit log.
export async function GET(req: NextRequest, { params }: { params: Promise<{ table: string }> }) {
  const auth = await requirePermission('data.export')
  if (auth.error) return auth.error
  const { table: key } = await params
  if (!isExportKey(key)) return NextResponse.json({ error: 'Unknown table.' }, { status: 404 })

  const table = await buildExport(key)
  await recordAudit(prisma, auditContext(req, auth.principal), {
    action: 'data.export', entityType: 'data_export', entityId: key, metadata: { rows: table.rows.length },
  })
  const date = new Date().toISOString().slice(0, 10)
  return new Response(toCsv(table), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="millionaires-club-${key.replace(/_/g, '-')}-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
