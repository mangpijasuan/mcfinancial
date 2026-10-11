import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import type { NextRequest } from 'next/server'
import { readJsonObject } from '@/lib/http'
import { auditContext } from '@/modules/audit'
import { can, type StaffPrincipal } from '@/modules/auth'
import { ImportError, applyImport, previewImport, type ImportKind } from '@/modules/data/import'

// The shared body of the import routes (src/app/api/data/import/*): each
// route checks its own permission first, then hands over here.

async function readCsv(req: NextRequest) {
  const body = await readJsonObject(req)
  return typeof body?.csv === 'string' ? body : null
}

export async function previewResponse(req: NextRequest, kind: ImportKind, principal: StaffPrincipal) {
  const body = await readCsv(req)
  if (!body) return NextResponse.json({ error: 'Choose a CSV file to import.' }, { status: 400 })
  try {
    return NextResponse.json(await previewImport(kind, body.csv, { canUpdateMembers: can(principal, 'members.update') }))
  } catch (err) {
    if (err instanceof ImportError) return NextResponse.json({ error: err.message }, { status: 400 })
    throw err
  }
}

export async function importResponse(req: NextRequest, kind: ImportKind, principal: StaffPrincipal) {
  const body = await readCsv(req)
  if (!body) return NextResponse.json({ error: 'Choose a CSV file to import.' }, { status: 400 })
  if (typeof body.fileHash !== 'string') return NextResponse.json({ error: 'Preview the file before importing it.' }, { status: 400 })
  try {
    const result = await applyImport(kind, body.csv, {
      fileHash: body.fileHash, fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
      canUpdateMembers: can(principal, 'members.update'),
    }, auditContext(req, principal))
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof ImportError) return NextResponse.json({ error: err.message }, { status: 409 })
    // The same file imported twice at the same moment: the second is refused.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'This file was just imported.' }, { status: 409 })
    }
    throw err
  }
}
