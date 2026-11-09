import { NextRequest } from 'next/server'
import { requirePermission } from '@/modules/auth'
import { importResponse } from '@/lib/importRoute'

// Sends each reversal in the previewed spreadsheet for approval: all of them, or none.
export async function POST(req: NextRequest) {
  const auth = await requirePermission('contributions.reverse')
  if (auth.error) return auth.error
  return importResponse(req, 'contribution_reversals', auth.principal)
}
