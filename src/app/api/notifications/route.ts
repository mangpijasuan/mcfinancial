import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail, contributionReminderEmail, loanOverdueEmail, adminSummaryEmail } from '@/lib/email'
import { requirePermission } from '@/modules/auth'
import { auditContext, recordAudit } from '@/modules/audit'
import { outstandingDollars } from '@/modules/accounting/reads'

export async function GET() {
  const auth = await requirePermission('notifications.read')
  if (auth.error) return auth.error

  // Return preview stats (who would receive emails)
  const [unpaidMembers, overdueLoans, recentLogs] = await Promise.all([
    prisma.member.findMany({
      where: { status: 'Active', thisMonth: 'NOT PAID', email: { not: null } },
      select: { id: true, legalName: true, email: true, monthsActive: true, archiveLifetime: true },
    }),
    prisma.loan.findMany({
      where: { overdue: true, status: 'Active' },
      include: { borrower: { select: { email: true, legalName: true } } },
    }),
    prisma.emailLog.findMany({ orderBy: { sentAt: 'desc' }, take: 20 }),
  ])

  return NextResponse.json({ unpaidMembers, overdueLoans, recentLogs })
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission('notifications.send')
  if (auth.error) return auth.error

  const body = await req.json().catch(() => ({}))
  const type = body?.type
  // Emails cannot be un-sent, so the entry is written after the send.
  const audit = (metadata: Record<string, unknown>) =>
    recordAudit(prisma, auditContext(req, auth.principal), {
      action: 'notifications.send', entityType: 'notification', entityId: String(type), metadata,
    })

  if (type === 'contribution_reminders') {
    const members = await prisma.member.findMany({
      where: { status: 'Active', thisMonth: 'NOT PAID', email: { not: null } },
      select: { id: true, legalName: true, email: true, monthsActive: true, archiveLifetime: true },
    })

    let sent = 0, failed = 0
    const logs = []

    for (const m of members) {
      const { subject, html } = contributionReminderEmail(m)
      const result = await sendEmail(m.email!, subject, html)
      logs.push({ type: 'contribution_reminder', recipient: m.email!, subject, status: result.ok ? 'sent' : 'failed' })
      result.ok ? sent++ : failed++
    }

    await prisma.emailLog.createMany({ data: logs })
    await audit({ sent, failed, total: members.length })
    return NextResponse.json({ sent, failed, total: members.length })
  }

  if (type === 'loan_overdue') {
    const loans = await prisma.loan.findMany({
      where: { overdue: true, status: 'Active' },
      include: { borrower: { select: { email: true, legalName: true, id: true } } },
    })

    let sent = 0, failed = 0
    const logs = []

    for (const loan of loans) {
      if (!loan.borrower.email) continue
      const { subject, html } = loanOverdueEmail(loan.borrower, loan)
      const result = await sendEmail(loan.borrower.email, subject, html)
      logs.push({ type: 'loan_overdue', recipient: loan.borrower.email, subject, status: result.ok ? 'sent' : 'failed' })
      result.ok ? sent++ : failed++
    }

    await prisma.emailLog.createMany({ data: logs })
    await audit({ sent, failed, total: loans.length })
    return NextResponse.json({ sent, failed, total: loans.length })
  }

  if (type === 'admin_summary') {
    const adminEmail = process.env.ADMIN_EMAIL
    if (!adminEmail) return NextResponse.json({ error: 'Set ADMIN_EMAIL in .env to receive summaries.' }, { status: 400 })

    const [activeMembers, activeLoans, unpaidCount, overdueCount, contribAgg, recentContribs] = await Promise.all([
      prisma.member.count({ where: { status: 'Active' } }),
      prisma.loan.count({ where: { status: 'Active' } }),
      prisma.member.count({ where: { status: 'Active', thisMonth: 'NOT PAID' } }),
      prisma.loan.count({ where: { overdue: true } }),
      prisma.contribution.aggregate({ where: { reversedAt: null }, _sum: { amount: true } }),
      prisma.contribution.findMany({ where: { reversedAt: null }, orderBy: { paymentDate: 'desc' }, take: 8, select: { memberName: true, amount: true, monthYear: true } }),
    ])

    const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })
    const { subject, html } = adminSummaryEmail({
      activeMembers, activeLoans, unpaidThisMonth: unpaidCount, overdueLoans: overdueCount,
      totalContributions: contribAgg._sum.amount ?? 0,
      outstandingBalance: await outstandingDollars(prisma),
      month, recentContribs,
    })

    const result = await sendEmail(adminEmail, subject, html)
    await prisma.emailLog.create({ data: { type: 'admin_summary', recipient: adminEmail, subject, status: result.ok ? 'sent' : 'failed' } })
    await audit({ sent: result.ok ? 1 : 0, failed: result.ok ? 0 : 1, total: 1 })

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ sent: 1, failed: 0, total: 1 })
  }

  return NextResponse.json({ error: 'Unknown notification type' }, { status: 400 })
}
