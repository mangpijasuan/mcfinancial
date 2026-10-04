// Check the club's data file before loading it (runbook Stage 2). Reads the
// same variables as the seed and writes nothing, so it needs no database:
//
//   SEED_DATA_FILE=/dev/shm/club-data.json [SEED_HISTORICAL_LOANS_FILE=...] npm run data:check
//
// Prints record counts and totals to compare with the Treasurer's records,
// then any problems, named by record ID. Exits 1 when the seed would refuse
// the file, 2 when no file is given.
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import { checkClubData, formatDataCheck } from '@/modules/data/fileCheck'

function readJson(file: string) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`Cannot read ${file} as JSON: ${err instanceof Error ? err.message : err}`)
  }
}

function main() {
  const file = process.env.SEED_DATA_FILE
  if (!file) {
    console.error('Set SEED_DATA_FILE to the decrypted club data file (kept outside the repository).')
    process.exitCode = 2
    return
  }
  const historicalFile = process.env.SEED_HISTORICAL_LOANS_FILE
  const check = checkClubData(readJson(file), Prisma.dmmf.datamodel.models, historicalFile ? readJson(historicalFile) : undefined)
  console.log(formatDataCheck(check))
  if (check.errors.length) process.exitCode = 1
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
}
