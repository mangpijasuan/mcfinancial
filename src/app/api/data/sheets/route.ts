import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/modules/auth'
import { auditContext } from '@/modules/audit'
import { GoogleSheetsError, exportToGoogleSheets, sheetsStatus } from '@/modules/data/googleSheets'

// The read-only Google Sheets copy: whether it is set up, and "Copy now".
export async function GET() {
  const auth = await requirePermission('data.export')
  if (auth.error) return auth.error
  return NextResponse.json(await sheetsStatus())
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission('data.export')
  if (auth.error) return auth.error
  try {
    const result = await exportToGoogleSheets(auditContext(req, auth.principal))
    return NextResponse.json({ result, status: await sheetsStatus() })
  } catch (err) {
    if (err instanceof GoogleSheetsError) return NextResponse.json({ error: err.message }, { status: 502 })
    throw err
  }
}
