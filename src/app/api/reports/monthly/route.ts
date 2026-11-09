import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/dates'
import { badRequest } from '@/lib/http'
import { requirePermission } from '@/modules/auth'
import { toCsv } from '@/modules/data/export'
import { buildMonthlyReport, monthlyReportRows, reportMonth } from '@/modules/contributions/monthlyReport'
import { monthlyReportPdf } from '@/modules/contributions/monthlyReportPdf'

// The monthly contributions report: ?month=YYYY-MM (this month by default),
// &format=pdf or csv to download it; JSON otherwise (amounts in cents).
export async function GET(req: NextRequest) {
  const auth = await requirePermission('contributions.read')
  if (auth.error) return auth.error
  const params = req.nextUrl.searchParams
  const month = reportMonth(params.get('month'), todayIso())
  if (!month) return badRequest('month must be YYYY-MM, and not in the future.')
  const format = params.get('format') ?? 'json'
  if (!['json', 'pdf', 'csv'].includes(format)) return badRequest('format must be pdf, csv or json.')

  const report = await buildMonthlyReport(prisma, month)
  const file = `Millionaires-Club-Monthly-Contributions-${month}`
  if (format === 'pdf') {
    return new NextResponse(Buffer.from(await monthlyReportPdf(report)), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${file}.pdf"`, 'Cache-Control': 'no-store' },
    })
  }
  if (format === 'csv') {
    return new NextResponse(toCsv(monthlyReportRows(report)), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}.csv"`, 'Cache-Control': 'no-store' },
    })
  }
  return NextResponse.json(report)
}
