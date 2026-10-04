import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

// Copies a legacy SQLite database (prisma/dev.db) into PostgreSQL:
//   npm run db:migrate-sqlite [-- path/to/dev.db]
// Real member data: run it only against a database outside git (A15).

const sqlitePath = resolve(process.argv[2] || 'prisma/dev.db')
if (!existsSync(sqlitePath)) {
  throw new Error(`Legacy SQLite database not found: ${sqlitePath}`)
}

const prisma = new PrismaClient()

function readTable(table) {
  const output = execFileSync('sqlite3', ['-json', sqlitePath, `SELECT * FROM "${table}"`], {
    encoding: 'utf8',
  }).trim()
  return output ? JSON.parse(output) : []
}

function select(row, fields, dateFields = []) {
  return Object.fromEntries(fields.map((field) => {
    const value = row[field]
    return [field, dateFields.includes(field) && value != null ? new Date(value) : value]
  }))
}

const definitions = {
  Member: {
    fields: ['id', 'legalName', 'nickname', 'joinDate', 'status', 'phoneNo', 'email', 'beneficiary', 'notes', 'archiveLifetime', 'contributions2026', 'overallContributions', 'monthsActive', 'maxLoanAmount', 'currentLoanBalance', 'eligible', 'activeAsBorrower', 'activeAsCosigner', 'lastContributionDate', 'thisMonth', 'riskFlag', 'portalEnabled', 'portalPassword', 'createdAt', 'updatedAt'],
    dates: ['joinDate', 'lastContributionDate', 'createdAt', 'updatedAt'],
  },
  YearlyTotal: { fields: ['id', 'memberId', 'year', 'amount'] },
  Contribution: {
    fields: ['id', 'transactionId', 'memberId', 'memberName', 'paymentDate', 'monthYear', 'amount', 'paymentMethod', 'receivedBy', 'comments', 'source', 'entryTimestamp'],
    dates: ['paymentDate', 'entryTimestamp'],
  },
  Loan: {
    fields: ['id', 'loanId', 'borrowerId', 'borrowerName', 'cosignerId', 'cosignerName', 'loanDate', 'termMonths', 'loanAmount', 'monthlyDue', 'totalPaid', 'balanceRemaining', 'status', 'endDate', 'nextDueDate', 'overdue', 'notes', 'createdAt', 'updatedAt'],
    dates: ['loanDate', 'endDate', 'nextDueDate', 'createdAt', 'updatedAt'],
  },
  LoanPayment: {
    fields: ['id', 'paymentId', 'loanId', 'borrowerId', 'borrowerName', 'paymentDate', 'amount', 'paymentMethod', 'receivedBy', 'comments', 'source', 'monthYear', 'createdAt'],
    dates: ['paymentDate', 'createdAt'],
  },
  HistoricalLoan: {
    fields: ['id', 'loanId', 'year', 'borrowerName', 'cosignerName', 'loanDate', 'endDate', 'loanAmount', 'totalPaid', 'balanceRemaining', 'status', 'createdAt'],
    dates: ['loanDate', 'endDate', 'createdAt'],
  },
  Withdrawal: {
    fields: ['id', 'withdrawalId', 'memberId', 'memberName', 'amount', 'withdrawalDate', 'type', 'reason', 'processedBy', 'notes', 'createdAt'],
    dates: ['withdrawalDate', 'createdAt'],
  },
  EmailLog: {
    fields: ['id', 'type', 'recipient', 'subject', 'status', 'sentAt'],
    dates: ['sentAt'],
  },
  LoanAgreement: {
    fields: ['id', 'agreementId', 'loanId', 'borrowerName', 'borrowerId', 'borrowerAddress', 'borrowerCity', 'borrowerState', 'cosignerName', 'cosignerId', 'lenderName', 'applicationFee', 'loanAmount', 'monthlyPayment', 'termMonths', 'startDate', 'endDate', 'borrowerSignature', 'borrowerSignedAt', 'cosignerSignature', 'cosignerSignedAt', 'lenderSignature', 'lenderSignedAt', 'status', 'createdAt'],
    dates: ['startDate', 'endDate', 'borrowerSignedAt', 'cosignerSignedAt', 'lenderSignedAt', 'createdAt'],
  },
}

async function main() {
  const rows = Object.fromEntries(Object.entries(definitions).map(([table, definition]) => [
    table,
    readTable(table).map((row) => select(row, definition.fields, definition.dates)),
  ]))

  rows.Member = rows.Member.map((member) => ({ ...member, portalEnabled: Boolean(member.portalEnabled) }))
  rows.Loan = rows.Loan.map((loan) => ({
    ...loan,
    overdue: Boolean(loan.overdue),
    // Legacy loans were paid out long ago; keep their stage in step with the status.
    lifecycle: loan.status === 'Paid Off' ? 'paid_off' : loan.status === 'Cancelled' ? 'cancelled' : 'disbursed',
  }))
  // Money in exact cents (legacy amounts are floats of whole cents).
  rows.Contribution = rows.Contribution.map((c) => ({ ...c, amountCents: BigInt(Math.round(Number(c.amount) * 100)) }))
  rows.LoanAgreement = rows.LoanAgreement.map((agreement) => ({
    ...agreement,
    lenderName: agreement.lenderName === 'MC Finance' ? 'Millionaires Club' : agreement.lenderName,
  }))

  const admins = readTable('Admin').map((row) => ({
    ...select(row, ['id', 'email', 'name', 'password', 'linkedMemberId', 'createdAt'], ['createdAt']),
    email: row.email === 'admin@millionairesclub.com' ? 'admin@mcfinancial.local' : row.email,
    name: row.email === 'admin@millionairesclub.com' ? 'Millionaires Club Admin' : row.name,
    legacyRole: row.role,
  }))

  await prisma.$transaction(async (tx) => {
    await tx.member.createMany({ data: rows.Member, skipDuplicates: true })
    // Staff become staff users (M8), keeping their ids and password hashes.
    for (const { legacyRole, password, linkedMemberId, ...admin } of admins) {
      await tx.user.upsert({
        where: { email: admin.email }, update: {},
        create: { ...admin, kind: 'staff', passwordHash: password, memberId: linkedMemberId ?? null },
      })
      const saved = await tx.user.findUniqueOrThrow({ where: { email: admin.email } })
      await tx.staffRoleAssignment.upsert({
        where: { userId_role: { userId: saved.id, role: legacyRole === 'super_admin' ? 'super_admin' : 'club_officer' } },
        update: {},
        create: { userId: saved.id, role: legacyRole === 'super_admin' ? 'super_admin' : 'club_officer' },
      })
    }
    // Members' portal passwords become member logins with the same hash
    // (the same step as src/modules/auth/memberLogins.ts adoptPortalLogins).
    await tx.$executeRawUnsafe(`
      INSERT INTO "User" ("id", "kind", "name", "passwordHash", "memberId", "createdAt", "disabledAt", "sessionsValidAfter")
      SELECT 'mu_' || replace(gen_random_uuid()::text, '-', ''), 'member', m."legalName", m."portalPassword", m."id", CURRENT_TIMESTAMP,
             CASE WHEN m."portalEnabled" THEN NULL ELSE CURRENT_TIMESTAMP END, m."portalSessionsValidAfter"
      FROM "Member" m
      WHERE m."portalPassword" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."kind" = 'member' AND u."memberId" = m."id")`)
    await tx.yearlyTotal.createMany({ data: rows.YearlyTotal, skipDuplicates: true })
    await tx.contribution.createMany({ data: rows.Contribution, skipDuplicates: true })
    await tx.loan.createMany({ data: rows.Loan, skipDuplicates: true })
    await tx.loanPayment.createMany({ data: rows.LoanPayment, skipDuplicates: true })
    await tx.historicalLoan.createMany({ data: rows.HistoricalLoan, skipDuplicates: true })
    await tx.withdrawal.createMany({ data: rows.Withdrawal, skipDuplicates: true })
    await tx.emailLog.createMany({ data: rows.EmailLog, skipDuplicates: true })
    await tx.loanAgreement.createMany({ data: rows.LoanAgreement, skipDuplicates: true })
  }, { timeout: 60_000 })

  const migrated = {
    members: await prisma.member.count(),
    contributions: await prisma.contribution.count(),
    loans: await prisma.loan.count(),
    loanPayments: await prisma.loanPayment.count(),
    historicalLoans: await prisma.historicalLoan.count(),
    agreements: await prisma.loanAgreement.count(),
    withdrawals: await prisma.withdrawal.count(),
  }
  console.log('SQLite migration complete:', migrated)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
