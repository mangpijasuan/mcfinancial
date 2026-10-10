import { NextRequest } from 'next/server'
import { requirePermission } from '@/modules/auth'
import { previewResponse } from '@/lib/importRoute'

// What importing this spreadsheet would do, row by row. Saves nothing.
export async function POST(req: NextRequest) {
  const auth = await requirePermission('contributions.record')
  if (auth.error) return auth.error
  return previewResponse(req, 'contributions', auth.principal)
}
