const fs = require('fs')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

function normalizeDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeHistoricalLoan(record) {
  return {
    loanId: record.loanId,
    year: record.year,
    borrowerName: record.borrowerName,
    cosignerName: record.cosignerName ?? null,
    loanDate: normalizeDate(record.loanDate),
    endDate: normalizeDate(record.endDate),
    loanAmount: Number(record.loanAmount),
    totalPaid: Number(record.totalPaid ?? 0),
    balanceRemaining: Number(record.balanceRemaining ?? 0),
    status: record.status,
  }
}

async function main() {
  // The source file holds real member data and lives outside the repository
  // (Gate #1 A15): pass its path, e.g. a decrypted copy on a tmpfs.
  const historicalPath = process.env.HISTORICAL_LOANS_FILE
  if (!historicalPath) {
    console.error('Set HISTORICAL_LOANS_FILE to the historical loans JSON (kept outside the repository).')
    process.exit(2)
  }
  const sourceHistoricalLoans = JSON.parse(fs.readFileSync(historicalPath, 'utf8')).map(normalizeHistoricalLoan)
  const dbHistoricalLoans = (await prisma.historicalLoan.findMany()).map(normalizeHistoricalLoan)

  const dbById = new Map(dbHistoricalLoans.map((loan) => [loan.loanId, loan]))

  const missingInDb = []
  const mismatched = []

  for (const sourceLoan of sourceHistoricalLoans) {
    const dbLoan = dbById.get(sourceLoan.loanId)
    if (!dbLoan) {
      missingInDb.push(sourceLoan.loanId)
      continue
    }

    const sourceJson = JSON.stringify(sourceLoan)
    const dbJson = JSON.stringify(dbLoan)
    if (sourceJson !== dbJson) {
      mismatched.push(sourceLoan.loanId)
    }
  }

  const liveLoanCount = await prisma.loan.count()
  const activeLiveLoanCount = await prisma.loan.count({ where: { status: 'Active' } })
  const historicalStatusCounts = await prisma.historicalLoan.groupBy({
    by: ['status'],
    _count: { status: true },
  })

  console.log(`Historical source rows: ${sourceHistoricalLoans.length}`)
  console.log(`Historical DB rows: ${dbHistoricalLoans.length}`)
  console.log(`Historical missing in DB: ${missingInDb.length}`)
  console.log(`Historical mismatched rows: ${mismatched.length}`)
  console.log(`Live loans: ${liveLoanCount}`)
  console.log(`Active live loans: ${activeLiveLoanCount}`)
  console.log('Historical status counts:', historicalStatusCounts)

  if (missingInDb.length || mismatched.length) {
    if (missingInDb.length) {
      console.log('Missing loan IDs:', missingInDb.slice(0, 25))
    }
    if (mismatched.length) {
      console.log('Mismatched loan IDs:', mismatched.slice(0, 25))
    }
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })