import { NextRequest } from 'next/server'
import { requirePermission } from '@/modules/auth'
import { importResponse } from '@/lib/importRoute'

// Imports the previewed spreadsheet: all of it, in one transaction, or none.
export async function POST(req: NextRequest) {
  const auth = await requirePermission('contributions.record')
  if (auth.error) return auth.error
  return importResponse(req, 'contributions', auth.principal)
}
