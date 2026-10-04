// New members get sequential numbers (M8): MC- and one more than the
// highest number in use, keeping its width (at least four digits). It is
// worked out when the member is added, so numbers loaded by an import count.
import type { Prisma } from '@prisma/client'

const NUMBERED = /^MC-(\d+)$/

/** The member number after the highest of these ids. */
export function nextMemberNumber(ids: readonly string[]): string {
  let top = 0
  let width = 4
  for (const id of ids) {
    const digits = NUMBERED.exec(id)?.[1]
    if (!digits) continue
    const n = Number(digits)
    if (n > top) { top = n; width = Math.max(4, digits.length) }
  }
  return `MC-${String(top + 1).padStart(width, '0')}`
}

/** The next member number, held until the transaction ends so two new members never get the same one. */
export async function allocateMemberId(tx: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<string> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('member-numbers'))::text`
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Member" WHERE "id" ~ '^MC-[0-9]+$'`
  return nextMemberNumber(rows.map((r) => r.id))
}
