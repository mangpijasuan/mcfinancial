'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Printer, ArrowLeft } from 'lucide-react'
import { Button, Card, Badge, Spinner } from '@/components/ui'
import { fmt$, fmtDate } from '@/lib/utils'
import { APP_NAME } from '@/lib/brand'

type Member = {
  id: string
  legalName: string
  nickname?: string | null
  joinDate?: string | null
  status: string
}

type Contribution = {
  memberId: string
  memberName: string
  amount: number
  monthYear: string
  paymentMethod?: string | null
  paymentDate: string
  comments?: string | null
}

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export default function MonthlyContributionsPrintPage() {
  const router = useRouter()
  const params = useSearchParams()
  const month = params.get('month') || defaultMonthYear()

  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<Member[]>([])
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError('')

        const [membersRes, contribRes] = await Promise.all([
          fetch('/api/members?status=Active&limit=1000'),
          fetch(`/api/contributions?month=${encodeURIComponent(month)}&limit=1000&page=1`),
        ])

        const membersData = await readJsonSafe<any>(membersRes)
        const contribData = await readJsonSafe<any>(contribRes)

        if (!membersRes.ok || !contribRes.ok || !membersData || !contribData) {
          throw new Error('Failed to load monthly report data.')
        }

        if (cancelled) return
        setMembers(Array.isArray(membersData.members) ? membersData.members : [])
        setContributions(Array.isArray(contribData.contributions) ? contribData.contributions : [])
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load monthly report data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [month])

  const paidMap = useMemo(() => {
    const map = new Map<string, Contribution>()
    for (const c of contributions) map.set(c.memberId, c)
    return map
  }, [contributions])

  const paidMembers = members.filter(m => paidMap.has(m.id))
  const unpaidMembers = members.filter(m => !paidMap.has(m.id))
  const totalPaid = contributions.reduce((sum, c) => sum + (c.amount || 0), 0)
  const reportRows = [...members]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((m) => {
      const c = paidMap.get(m.id)
      return {
        memberId: m.id,
        legalName: m.legalName,
        nickname: m.nickname,
        joinDate: m.joinDate,
        month,
        amount: c?.amount ?? null,
        comments: c?.comments ?? null,
        paid: !!c,
      }
    })

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 print:p-0">
        <div className="flex items-center justify-between gap-3 mb-4 print:hidden">
          <Button variant="secondary" size="sm" onClick={() => router.back()}><ArrowLeft size={15} /> Back</Button>
          <Button size="sm" onClick={() => window.print()}><Printer size={15} /> Print</Button>
        </div>

        {loading ? (
          <div className="p-10 flex justify-center"><Spinner /></div>
        ) : error ? (
          <Card className="p-6 text-red-700 bg-red-50 border-red-200">{error}</Card>
        ) : (
          <Card className="p-0 overflow-hidden shadow-xs print:shadow-none print:border-none">
            <div className="bg-[#fffdf7] border-b border-amber-200 px-6 py-5 text-center print:px-0">
              <p className="text-2xl font-bold tracking-wide text-gray-900">Monthly Contributions Report</p>
              <p className="text-xs uppercase tracking-[0.25em] text-gray-500 mt-1">{APP_NAME}</p>
              <div className="mt-3 flex items-center justify-center gap-2 text-sm text-gray-600">
                <Badge variant="amber">{month}</Badge>
                <span>•</span>
                <span>{members.length} active members</span>
                <span>•</span>
                <span>{paidMembers.length} paid</span>
                <span>•</span>
                <span>{unpaidMembers.length} not paid</span>
                <span>•</span>
                <span>{fmt$(totalPaid)} collected</span>
              </div>
            </div>

            <div className="p-6 print:p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-2">Member ID</th>
                    <th className="py-2 pr-2">Name</th>
                    <th className="py-2 pr-2">Nickname</th>
                    <th className="py-2 pr-2">Joined</th>
                    <th className="py-2 pr-2">Month</th>
                    <th className="py-2 pr-2 text-right">Amount</th>
                    <th className="py-2 pr-2">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.length === 0 ? (
                    <tr><td className="py-4 text-gray-400" colSpan={7}>No members found.</td></tr>
                  ) : reportRows.map((r) => (
                    <tr key={r.memberId} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-2 font-mono text-xs text-indigo-600">{r.memberId}</td>
                      <td className="py-2 pr-2 font-medium text-gray-900">{r.legalName}</td>
                      <td className="py-2 pr-2 text-gray-600">{r.nickname || '—'}</td>
                      <td className="py-2 pr-2 text-gray-600 whitespace-nowrap">{fmtDate(r.joinDate)}</td>
                      <td className="py-2 pr-2 text-gray-600">{r.month}</td>
                      <td className="py-2 pr-2 text-right font-semibold text-green-700">{r.amount != null ? fmt$(r.amount) : '—'}</td>
                      <td className="py-2 pr-2 text-gray-600">{r.paid ? (r.comments || '—') : 'Not paid'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 pb-6 text-xs text-gray-500 print:px-4 print:pb-4">
              Printed on {fmtDate(new Date())}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function defaultMonthYear() {
  const date = new Date()
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[date.getMonth()]}-${date.getFullYear()}`
}
